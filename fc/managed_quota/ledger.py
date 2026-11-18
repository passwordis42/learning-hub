import json
import secrets
import hashlib

DAILY_CAP = 1_000_000
SESSION_LIMIT = 6
SESSION_CONCURRENCY = 1
IP_LIMIT = 20
IP_CONCURRENCY = 2
SITE_LIMIT = 30
SITE_CONCURRENCY = 4
RATE_WINDOW_SECONDS = 60
SESSION_TTL_SECONDS = 30 * 60


class LedgerError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Ledger:
    """算法账本。SQLite 只验证状态机，不是表格存储适配通过。"""

    def __init__(self, store, clock, cap=DAILY_CAP, session_limit=SESSION_LIMIT, ip_limit=IP_LIMIT, site_limit=SITE_LIMIT, session_concurrency=SESSION_CONCURRENCY, ip_concurrency=IP_CONCURRENCY, site_concurrency=SITE_CONCURRENCY):
        self.store = store
        self.clock = clock
        self.cap = cap
        self.session_limit = session_limit
        self.ip_limit = ip_limit
        self.site_limit = site_limit
        self.session_concurrency = session_concurrency
        self.ip_concurrency = ip_concurrency
        self.site_concurrency = site_concurrency

    def issue_session(self, ip):
        now = self.clock.now()
        raw = secrets.token_hex(16)
        digest = _hash(raw)
        with self.store.exclusive() as conn:
            _rate(conn, f'ip:{ip or "unattributed"}', int(now.timestamp()), self.ip_limit)
            conn.execute('INSERT INTO session (session_hash, ip, created_epoch, expires_epoch) VALUES (?, ?, ?, ?)', (digest, ip or 'unattributed', int(now.timestamp()), int(now.timestamp()) + SESSION_TTL_SECONDS))
        return raw

    def observe(self, *, session_id, ip):
        now = self.clock.now()
        session_hash = _hash(session_id)
        with self.store.exclusive() as conn:
            _session_open(conn, session_hash, int(now.timestamp()))
            _rate(conn, f'session:{session_hash}', int(now.timestamp()), self.session_limit)
            _rate(conn, f'ip:{ip or "unattributed"}', int(now.timestamp()), self.ip_limit)
            _rate(conn, 'site', int(now.timestamp()), self.site_limit)

    def reserve(self, *, session_id, key, fingerprint, entry, amount, evidence_version, ip):
        now = self.clock.now()
        day = now.date().isoformat()
        session_hash = _hash(session_id)
        request_id = f'{session_hash}:{key}'
        with self.store.exclusive() as conn:
            _session_open(conn, session_hash, int(now.timestamp()))
            existing = conn.execute('SELECT * FROM reservation WHERE request_id = ?', (request_id,)).fetchone()
            if existing is not None:
                if existing['fingerprint'] != fingerprint:
                    raise LedgerError('idempotency_conflict', '同一幂等键不能改用另一份请求')
                return _view(existing, replay=True, send=False)
            _rate(conn, f'session:{session_hash}', int(now.timestamp()), self.session_limit)
            _rate(conn, f'ip:{ip or "unattributed"}', int(now.timestamp()), self.ip_limit)
            _rate(conn, 'site', int(now.timestamp()), self.site_limit)
            _concurrency(conn, 'session', session_hash, self.session_concurrency)
            _ip_concurrency(conn, ip or 'unattributed', self.ip_concurrency)
            _concurrency(conn, 'site', '*', self.site_concurrency)
            bucket = _day(conn, day, self.cap)
            if bucket['breached']:
                raise LedgerError('fused', '上界保证已失效，托管助手已停用。课程仍可阅读。')
            if bucket['settled_u'] + bucket['held_h'] + amount > self.cap:
                raise LedgerError('budget', '今天可准入的托管额度不够。这不是百炼账户的自然日总额。课程仍可阅读。')
            conn.execute('UPDATE day_bucket SET held_h = held_h + ?, version = version + 1 WHERE day = ? AND breached = 0 AND settled_u + held_h + ? <= cap', (amount, day, amount))
            if conn.execute('SELECT changes() AS n').fetchone()['n'] != 1:
                raise LedgerError('budget', '今天可准入的托管额度不够。这不是百炼账户的自然日总额。课程仍可阅读。')
            conn.execute('''INSERT INTO reservation
                (request_id, session_hash, idempotency_key, fingerprint, ip, day, entry, state, reserved_r, settled_a, usage_json, fence, evidence_version, adjusted, result_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, NULL, '', 0, ?, 0, '')''',
                (request_id, session_hash, key, fingerprint, ip or 'unattributed', day, entry, amount, evidence_version))
            _log(conn, now, 'reserved', entry, day, request_id)
            return _view(conn.execute('SELECT * FROM reservation WHERE request_id = ?', (request_id,)).fetchone(), replay=False, send=False)

    def commit_dispatch(self, *, session_id, key, fingerprint):
        request_id = f'{_hash(session_id)}:{key}'
        with self.store.exclusive() as conn:
            row = _row(conn, request_id, fingerprint)
            if row['state'] != 'RESERVED':
                return _view(row, replay=True, send=False)
            fence = row['fence'] + 1
            conn.execute("UPDATE reservation SET state = 'DISPATCH_COMMITTED', fence = ? WHERE request_id = ? AND state = 'RESERVED'", (fence, request_id))
            if conn.execute('SELECT changes() AS n').fetchone()['n'] != 1:
                return _view(_row(conn, request_id, fingerprint), replay=True, send=False)
            _log(conn, self.clock.now(), 'dispatch_committed', row['entry'], row['day'], request_id)
            return _view(_row(conn, request_id, fingerprint), replay=False, send=True)

    def release(self, *, session_id, key, fingerprint):
        request_id = f'{_hash(session_id)}:{key}'
        with self.store.exclusive() as conn:
            row = _row(conn, request_id, fingerprint)
            if row['state'] != 'RESERVED':
                raise LedgerError('send_sealed', '发权已承诺或请求已结束，不能退回预留')
            conn.execute("UPDATE reservation SET state = 'RELEASED', result_json = ? WHERE request_id = ? AND state = 'RESERVED'", (json.dumps({'released': True}), request_id))
            if conn.execute('SELECT changes() AS n').fetchone()['n'] != 1:
                raise LedgerError('send_sealed', '发权已承诺或请求已结束，不能退回预留')
            conn.execute('UPDATE day_bucket SET held_h = held_h - ?, version = version + 1 WHERE day = ?', (row['reserved_r'], row['day']))
            _log(conn, self.clock.now(), 'released', row['entry'], row['day'], request_id)
            return _view(_row(conn, request_id, fingerprint), replay=False, send=False)

    def settle(self, *, session_id, key, fingerprint, usage):
        request_id = f'{_hash(session_id)}:{key}'
        with self.store.exclusive() as conn:
            row = _row(conn, request_id, fingerprint)
            if row['state'] in ('SETTLED', 'CONSERVATIVE_SETTLED', 'BREACH') and row['adjusted']:
                return _view(row, replay=True, send=False)
            if row['state'] == 'SETTLED':
                return _view(row, replay=True, send=False)
            if row['state'] not in ('DISPATCH_COMMITTED', 'UNCERTAIN', 'CONSERVATIVE_SETTLED'):
                raise LedgerError('not_sent', '还没有发权，不能按用量结算')
            trusted = _trusted(usage, row['reserved_r'])
            if trusted is None:
                if _exceeds(usage, row['reserved_r']):
                    return _breach(conn, row, int(usage['total_tokens']), self.clock.now())
                if row['state'] == 'DISPATCH_COMMITTED':
                    return _uncertain(conn, row, 'usage_untrusted', self.clock.now())
                return _view(row, replay=True, send=False)
            if row['state'] == 'CONSERVATIVE_SETTLED':
                if row['adjusted']:
                    return _view(row, replay=True, send=False)
                delta = trusted - row['reserved_r']
                conn.execute('UPDATE day_bucket SET settled_u = settled_u + ?, version = version + 1 WHERE day = ?', (delta, row['day']))
                conn.execute("UPDATE reservation SET state = 'SETTLED', settled_a = ?, usage_json = ?, adjusted = 1, result_json = ? WHERE request_id = ?", (trusted, json.dumps(usage), json.dumps({'adjusted': True}), request_id))
            else:
                conn.execute('UPDATE day_bucket SET held_h = held_h - ?, settled_u = settled_u + ?, version = version + 1 WHERE day = ?', (row['reserved_r'], trusted, row['day']))
                conn.execute("UPDATE reservation SET state = 'SETTLED', settled_a = ?, usage_json = ?, adjusted = 1, result_json = ? WHERE request_id = ?", (trusted, json.dumps(usage), json.dumps({'settled': trusted}), request_id))
            _log(conn, self.clock.now(), 'settled', row['entry'], row['day'], request_id)
            return _view(_row(conn, request_id, fingerprint), replay=False, send=False)

    def uncertain(self, *, session_id, key, fingerprint, reason):
        request_id = f'{_hash(session_id)}:{key}'
        with self.store.exclusive() as conn:
            row = _row(conn, request_id, fingerprint)
            if row['state'] in ('UNCERTAIN', 'CONSERVATIVE_SETTLED', 'SETTLED', 'BREACH'):
                return _view(row, replay=True, send=False)
            if row['state'] != 'DISPATCH_COMMITTED':
                raise LedgerError('not_sent', '还没有发权')
            return _uncertain(conn, row, reason, self.clock.now())

    def conservative(self, *, session_id, key, fingerprint):
        request_id = f'{_hash(session_id)}:{key}'
        with self.store.exclusive() as conn:
            row = _row(conn, request_id, fingerprint)
            if row['state'] == 'CONSERVATIVE_SETTLED':
                return _view(row, replay=True, send=False)
            if row['state'] != 'UNCERTAIN':
                raise LedgerError('not_uncertain', '只有待核预留可以保守结转')
            conn.execute('UPDATE day_bucket SET held_h = held_h - ?, settled_u = settled_u + ?, version = version + 1 WHERE day = ?', (row['reserved_r'], row['reserved_r'], row['day']))
            conn.execute("UPDATE reservation SET state = 'CONSERVATIVE_SETTLED', settled_a = reserved_r, result_json = ? WHERE request_id = ?", (json.dumps({'conservative': True}), request_id))
            _log(conn, self.clock.now(), 'conservative', row['entry'], row['day'], request_id)
            return _view(_row(conn, request_id, fingerprint), replay=False, send=False)

    def day(self, day):
        with self.store.exclusive() as conn:
            row = conn.execute('SELECT * FROM day_bucket WHERE day = ?', (day,)).fetchone()
            if row is None:
                return {'settled_u': 0, 'held_h': 0, 'breached': False, 'cap': self.cap}
            return {'settled_u': row['settled_u'], 'held_h': row['held_h'], 'breached': bool(row['breached']), 'cap': row['cap']}

    def purge_logs(self, now):
        cutoff = int(now.timestamp()) - 7 * 24 * 60 * 60
        with self.store.exclusive() as conn:
            before = conn.execute('SELECT COUNT(*) AS n FROM reservation').fetchone()['n']
            conn.execute('DELETE FROM runtime_log WHERE created_epoch < ?', (cutoff,))
            after = conn.execute('SELECT COUNT(*) AS n FROM reservation').fetchone()['n']
            return {'logs': conn.execute('SELECT changes() AS n').fetchone()['n'], 'reservations': after, 'reservations_before': before}

    def reopen(self):
        raise LedgerError('review_required', '熔断后不能靠环境开关或 mock 重新放行')


def _hash(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _session_open(conn, session_hash, now_epoch):
    row = conn.execute('SELECT expires_epoch, ip FROM session WHERE session_hash = ?', (session_hash,)).fetchone()
    if row is None or row['expires_epoch'] < now_epoch:
        raise LedgerError('session_expired', '匿名会话已过期。旧键不能重新发送。')


def _rate(conn, bucket, now_epoch, limit):
    row = conn.execute('SELECT window_start, hits FROM rate_window WHERE bucket = ?', (bucket,)).fetchone()
    if row is None or now_epoch - row['window_start'] >= RATE_WINDOW_SECONDS:
        conn.execute('INSERT INTO rate_window (bucket, window_start, hits) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, hits = 1', (bucket, now_epoch))
        return
    if row['hits'] >= limit:
        raise LedgerError('rate_limited', '请求过于频繁。这不能识别真实访客。')
    conn.execute('UPDATE rate_window SET hits = hits + 1 WHERE bucket = ?', (bucket,))


def _ip_concurrency(conn, ip, limit):
    count = conn.execute("SELECT COUNT(*) AS n FROM reservation WHERE ip = ? AND state IN ('RESERVED', 'DISPATCH_COMMITTED')", (ip,)).fetchone()['n']
    if count >= limit:
        raise LedgerError('busy', '这个来源地址的同时请求已达当前初始上限')


def _concurrency(conn, scope, owner, limit):
    if scope == 'session':
        count = conn.execute("SELECT COUNT(*) AS n FROM reservation WHERE session_hash = ? AND state IN ('RESERVED', 'DISPATCH_COMMITTED')", (owner,)).fetchone()['n']
    else:
        count = conn.execute("SELECT COUNT(*) AS n FROM reservation WHERE state IN ('RESERVED', 'DISPATCH_COMMITTED')").fetchone()['n']
    if count >= limit:
        raise LedgerError('busy', '同时进行的托管请求已达当前初始上限')


def _day(conn, day, cap):
    row = conn.execute('SELECT * FROM day_bucket WHERE day = ?', (day,)).fetchone()
    if row is None:
        conn.execute('INSERT INTO day_bucket (day, settled_u, held_h, cap, breached, version) VALUES (?, 0, 0, ?, 0, 0)', (day, cap))
        row = conn.execute('SELECT * FROM day_bucket WHERE day = ?', (day,)).fetchone()
    return row


def _row(conn, request_id, fingerprint):
    row = conn.execute('SELECT * FROM reservation WHERE request_id = ?', (request_id,)).fetchone()
    if row is None:
        raise LedgerError('missing', '没有这笔预留')
    if row['fingerprint'] != fingerprint:
        raise LedgerError('idempotency_conflict', '同一幂等键不能改用另一份请求')
    return row


def _uncertain(conn, row, reason, now):
    conn.execute("UPDATE reservation SET state = 'UNCERTAIN', result_json = ? WHERE request_id = ?", (json.dumps({'uncertain': reason}), row['request_id']))
    _log(conn, now, 'uncertain', row['entry'], row['day'], row['request_id'])
    return _view(conn.execute('SELECT * FROM reservation WHERE request_id = ?', (row['request_id'],)).fetchone(), replay=False, send=False)


def _breach(conn, row, actual, now):
    release = row['reserved_r'] if row['state'] != 'CONSERVATIVE_SETTLED' else 0
    already = row['settled_a'] or 0
    if row['state'] == 'CONSERVATIVE_SETTLED':
        delta = actual - already
        conn.execute('UPDATE day_bucket SET settled_u = settled_u + ?, breached = 1, version = version + 1 WHERE day = ?', (delta, row['day']))
    else:
        conn.execute('UPDATE day_bucket SET held_h = held_h - ?, settled_u = settled_u + ?, breached = 1, version = version + 1 WHERE day = ?', (release, actual, row['day']))
    conn.execute("UPDATE reservation SET state = 'BREACH', settled_a = ?, adjusted = 1, result_json = ? WHERE request_id = ?", (actual, json.dumps({'breach': actual}), row['request_id']))
    _log(conn, now, 'breach', row['entry'], row['day'], row['request_id'])
    return _view(conn.execute('SELECT * FROM reservation WHERE request_id = ?', (row['request_id'],)).fetchone(), replay=False, send=False)


def _trusted(usage, reserved):
    if not isinstance(usage, dict):
        return None
    try:
        prompt = int(usage['prompt_tokens'])
        completion = int(usage['completion_tokens'])
        total = int(usage['total_tokens'])
    except (KeyError, TypeError, ValueError):
        return None
    if prompt < 0 or completion < 0 or total != prompt + completion or total > reserved:
        return None
    return total


def _exceeds(usage, reserved):
    if not isinstance(usage, dict):
        return False
    try:
        total = int(usage['total_tokens'])
        prompt = int(usage['prompt_tokens'])
        completion = int(usage['completion_tokens'])
    except (KeyError, TypeError, ValueError):
        return False
    return total == prompt + completion and total > reserved


def _view(row, replay, send):
    return {
        'request_id': row['request_id'],
        'day': row['day'],
        'state': row['state'],
        'reserved': row['reserved_r'],
        'settled': row['settled_a'],
        'fence': row['fence'],
        'replay': replay,
        'send': send,
    }


def _log(conn, now, code, entry, day, request_id):
    conn.execute('INSERT INTO runtime_log (created_epoch, code, entry, day, request_id) VALUES (?, ?, ?, ?, ?)', (int(now.timestamp()), code, entry, day, request_id))
