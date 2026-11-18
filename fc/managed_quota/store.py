import sqlite3
from pathlib import Path


class StorageFault(Exception):
    pass


class LedgerDriverUnconfigured(Exception):
    pass


class AdapterNotEvidenced(Exception):
    pass


class SqliteLedgerStore:
    """单文件事务，用来验证状态机。不是表格存储生产适配，也没有跨实例实测。"""

    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.exclusive() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS day_bucket (
                day TEXT PRIMARY KEY,
                settled_u INTEGER NOT NULL,
                held_h INTEGER NOT NULL,
                cap INTEGER NOT NULL,
                breached INTEGER NOT NULL,
                version INTEGER NOT NULL
            )''')
            conn.execute('''CREATE TABLE IF NOT EXISTS session (
                session_hash TEXT PRIMARY KEY,
                ip TEXT NOT NULL,
                created_epoch INTEGER NOT NULL,
                expires_epoch INTEGER NOT NULL
            )''')
            conn.execute('''CREATE TABLE IF NOT EXISTS reservation (
                request_id TEXT PRIMARY KEY,
                session_hash TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                ip TEXT NOT NULL,
                day TEXT NOT NULL,
                entry TEXT NOT NULL,
                state TEXT NOT NULL,
                reserved_r INTEGER NOT NULL,
                settled_a INTEGER,
                usage_json TEXT NOT NULL,
                fence INTEGER NOT NULL,
                evidence_version TEXT NOT NULL,
                adjusted INTEGER NOT NULL,
                result_json TEXT NOT NULL
            )''')
            conn.execute('''CREATE TABLE IF NOT EXISTS rate_window (
                bucket TEXT PRIMARY KEY,
                window_start INTEGER NOT NULL,
                hits INTEGER NOT NULL
            )''')
            conn.execute('''CREATE TABLE IF NOT EXISTS runtime_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_epoch INTEGER NOT NULL,
                code TEXT NOT NULL,
                entry TEXT NOT NULL,
                day TEXT NOT NULL,
                request_id TEXT NOT NULL
            )''')

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=30000')
        conn.execute('PRAGMA journal_mode=WAL')
        return conn

    def exclusive(self):
        return _Exclusive(self.connect())


class _Exclusive:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        try:
            self.conn.execute('BEGIN IMMEDIATE')
        except sqlite3.Error as error:
            self.conn.close()
            raise StorageFault('账本事务没有开始') from error
        return self.conn

    def __exit__(self, exc_type, _exc, _tb):
        try:
            if exc_type is None:
                self.conn.execute('COMMIT')
            else:
                self.conn.execute('ROLLBACK')
        except sqlite3.Error as error:
            raise StorageFault('账本提交结果未知') from error
        finally:
            self.conn.close()
        return False


class UnavailableStore:
    def exclusive(self):
        raise StorageFault('账本不可用')


class TablestoreLedgerStore:
    """未启用。官方 Python SDK 签名已读到，但恢复语义和费用没有在真实表上验证。"""

    def __init__(self):
        raise AdapterNotEvidenced(
            '表格存储适配未通过：未安装或调用 SDK，未验证 start 超时后事务是否已建立、commit 超时后如何查证，也未核对本账号 CU 费用。本地 SQLite 不能代替这次验证。'
        )
