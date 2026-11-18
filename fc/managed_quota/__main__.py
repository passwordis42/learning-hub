import json
import sys

from .handler import handle, store_from_env
from .store import LedgerDriverUnconfigured


def main():
    raw = sys.stdin.read()
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        event = {'version': 'invalid'}
    try:
        store = store_from_env({key: value for key, value in __import__('os').environ.items() if key.startswith('MANAGED_')})
    except LedgerDriverUnconfigured:
        store = None
    response = handle(event, store=store)
    sys.stdout.write(json.dumps(response, ensure_ascii=False))


if __name__ == '__main__':
    main()
