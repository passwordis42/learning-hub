ENTRIES = frozenset({'ai', 'game'})
MAX_BODY_BYTES = 64 * 1024
MAX_TEXT_CHARS = 8_000
KEY_RE_SOURCE = r'^[A-Za-z0-9_-]{8,80}$'

ALLOWED_FIELDS = frozenset({'entry', 'text'})


def normalize(body):
    if not isinstance(body, dict):
        raise ValueError('请求体必须是 JSON 对象')
    unknown = sorted(set(body) - ALLOWED_FIELDS)
    if unknown:
        raise ValueError('请求包含不允许的字段')
    entry = body.get('entry')
    text = body.get('text')
    if entry not in ENTRIES:
        raise ValueError('入口不在托管名单内')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('请填写要询问的内容')
    text = text.strip()
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError('内容超过本次允许的长度')
    return {'entry': entry, 'text': text}


def client_ip(event):
    http = (event.get('requestContext') or {}).get('http') if isinstance(event, dict) else None
    ip = http.get('sourceIp') if isinstance(http, dict) else None
    forwarded = ''
    headers = event.get('headers') if isinstance(event, dict) else None
    if isinstance(headers, dict):
        forwarded = headers.get('x-forwarded-for') or headers.get('X-Forwarded-For') or ''
    if not isinstance(ip, str) or not ip or len(ip) > 128 or any(char.isspace() for char in ip):
        return '', forwarded
    return ip, forwarded
