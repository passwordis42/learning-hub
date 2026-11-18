import base64
import hashlib
import json
import re

from .bounds import BoundUnavailable, production_bound
from .clock import BeijingClock
from .ledger import Ledger, LedgerError
from .policy import MAX_BODY_BYTES, client_ip, normalize
from .store import AdapterNotEvidenced, LedgerDriverUnconfigured, SqliteLedgerStore, StorageFault, TablestoreLedgerStore, UnavailableStore
from .upstream import ClosedUpstream, UpstreamClosed

KEY_RE = re.compile(r'^[A-Za-z0-9_-]{8,80}$')
CLOSED = '托管助手未接通。输入硬上界尚未证明，所以上游没有调用。这不是百炼账户的自然日总额。课程仍可阅读。'
EVIDENCE = '2026-11-18-unproven'


def handle(event, *, store=None, clock=None, bounds=None, upstream=None, cap=None):
    clock = clock or BeijingClock()
    bounds = bounds or production_bound
    upstream = upstream if upstream is not None else ClosedUpstream()
    parsed = _event(event)
    if 'statusCode' in parsed:
        return parsed
    if store is None:
        return _json(503, {'code': 'storage_unconfigured', 'message': '持久账本未配置，已拒绝调用。', 'reading': True})
    ledger = Ledger(store, clock, **({'cap': cap} if cap is not None else {}))
    ip, _forwarded = client_ip(parsed['event'])
    if parsed['op'] == 'session':
        if not ip:
            return _json(400, {'code': 'unattributed', 'message': '没有可信来源地址，不能建立会话。', 'reading': True})
        try:
            session_id = ledger.issue_session(ip)
        except LedgerError as error:
            return _error(error)
        except StorageFault:
            return _storage()
        return _json(200, {'code': 'session', 'sessionId': session_id, 'reading': True, 'bill': 'site-admission-day'})
    try:
        normalized = normalize(parsed['body'])
    except ValueError as error:
        return _json(400, {'code': 'bad_request', 'message': str(error), 'reading': True})
    try:
        amounts = bounds(normalized)
    except BoundUnavailable as error:
        try:
            ledger.observe(session_id=parsed['session'], ip=ip or 'unattributed')
        except LedgerError as limited:
            return _error(limited)
        except StorageFault:
            return _storage()
        return _json(503, {'code': 'UPPER_BOUND_UNPROVEN', 'message': CLOSED, 'obstacles': list(error.obstacles), 'reading': True, 'upstreamCalls': upstream.calls})
    amount = amounts[0] + amounts[1]
    digest = hashlib.sha256(json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    try:
        reserved = ledger.reserve(session_id=parsed['session'], key=parsed['key'], fingerprint=digest, entry=normalized['entry'], amount=amount, evidence_version=EVIDENCE, ip=ip or 'unattributed')
    except LedgerError as error:
        return _error(error)
    except StorageFault:
        return _storage()
    if not reserved['send'] and reserved['state'] != 'RESERVED':
        return _json(200, {'code': 'replay', 'state': reserved['state'], 'day': reserved['day'], 'reading': True, 'bill': 'site-admission-day'})
    try:
        granted = ledger.commit_dispatch(session_id=parsed['session'], key=parsed['key'], fingerprint=digest)
    except LedgerError as error:
        return _error(error)
    if not granted['send']:
        return _json(409, {'code': 'already_committed', 'message': '这笔请求已经取得发权，不会再发一次。', 'reading': True})
    try:
        usage = upstream.complete(normalized)
    except UpstreamClosed:
        ledger.uncertain(session_id=parsed['session'], key=parsed['key'], fingerprint=digest, reason='upstream_closed')
        return _json(503, {'code': 'UPPER_BOUND_UNPROVEN', 'message': CLOSED, 'reading': True, 'upstreamCalls': upstream.calls})
    except TimeoutError:
        ledger.uncertain(session_id=parsed['session'], key=parsed['key'], fingerprint=digest, reason='timeout')
        return _json(504, {'code': 'timeout', 'message': '没有按时收到可核对的用量。预留继续占着准入日的额度，不会自动退回。', 'reading': True})
    except ConnectionError:
        ledger.uncertain(session_id=parsed['session'], key=parsed['key'], fingerprint=digest, reason='disconnect')
        return _json(502, {'code': 'disconnect', 'message': '连接中断。预留继续占着准入日的额度，不会自动退回。', 'reading': True})
    outcome = ledger.settle(session_id=parsed['session'], key=parsed['key'], fingerprint=digest, usage=usage)
    return _json(200 if outcome['state'] == 'SETTLED' else 409, {'code': outcome['state'], 'day': outcome['day'], 'settled': outcome['settled'], 'reading': True, 'bill': 'site-admission-day'})


def store_from_env(env):
    if env.get('MANAGED_CHARS_PER_TOKEN'):
        raise LedgerDriverUnconfigured('字数系数不能充当硬上界证明')
    driver = env.get('MANAGED_LEDGER_DRIVER', '')
    if driver == 'tablestore':
        return TablestoreLedgerStore()
    if driver == 'sqlite':
        path = env.get('MANAGED_LEDGER_PATH', '')
        if not path:
            raise LedgerDriverUnconfigured('sqlite 只是本地 mock，而且没有给出文件')
        return SqliteLedgerStore(path)
    if driver == 'unavailable':
        return UnavailableStore()
    raise LedgerDriverUnconfigured('未配置已授权的持久账本')


def _event(event):
    if isinstance(event, (bytes, str)):
        try:
            event = json.loads(event)
        except json.JSONDecodeError:
            return _json(400, {'code': 'bad_event', 'message': '事件不是 JSON', 'reading': True})
    if not isinstance(event, dict) or event.get('version') != 'v1':
        return _json(400, {'code': 'bad_event', 'message': '只接受函数计算 HTTP 事件 v1', 'reading': True})
    http = (event.get('requestContext') or {}).get('http') or {}
    if http.get('method') not in ('POST',):
        return _json(405, {'code': 'method', 'message': '只接受 POST', 'reading': True})
    path = (http.get('path') or event.get('rawPath') or '').rstrip('/')
    if path not in ('/api/ai/session', '/api/ai/requests'):
        return _json(404, {'code': 'not_ai', 'message': '这不是托管助手入口。课程页面仍可阅读。', 'reading': True})
    raw = event.get('body') or ''
    if event.get('isBase64Encoded'):
        try:
            raw = base64.b64decode(raw, validate=True).decode('utf-8')
        except (ValueError, UnicodeDecodeError):
            return _json(400, {'code': 'bad_request', 'message': '请求体无法读取', 'reading': True})
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_BODY_BYTES:
        return _json(413, {'code': 'too_large', 'message': '请求体太大', 'reading': True})
    try:
        body = json.loads(raw or '{}')
    except json.JSONDecodeError:
        return _json(400, {'code': 'bad_request', 'message': '请求体不是 JSON', 'reading': True})
    headers = {str(name).lower(): value for name, value in (event.get('headers') or {}).items()}
    if path == '/api/ai/session':
        return {'op': 'session', 'event': event, 'body': body}
    key = str(headers.get('idempotency-key', '')).split(',', 1)[0].strip()
    session = str(headers.get('x-learning-session', '')).strip()
    if not KEY_RE.fullmatch(key):
        return _json(400, {'code': 'bad_key', 'message': '需要 8 到 80 位的幂等键', 'reading': True})
    if not KEY_RE.fullmatch(session):
        return _json(401, {'code': 'session_required', 'message': '需要匿名会话。会话不是登录，也不能证明你是唯一访客。', 'reading': True})
    return {'op': 'request', 'event': event, 'body': body, 'key': key, 'session': session}


def _error(error):
    status = {'budget': 402, 'fused': 403, 'idempotency_conflict': 409, 'rate_limited': 429, 'busy': 429, 'session_expired': 401}.get(error.code, 400)
    return _json(status, {'code': error.code, 'message': str(error), 'reading': True, 'bill': 'site-admission-day'})


def _storage():
    return _json(503, {'code': 'storage_unavailable', 'message': '账本不可用，已拒绝调用。', 'reading': True})


def _json(status, payload):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json'}, 'isBase64Encoded': False, 'body': json.dumps(payload, ensure_ascii=False)}
