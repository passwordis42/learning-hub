from datetime import datetime
from zoneinfo import ZoneInfo

BEIJING = ZoneInfo('Asia/Shanghai')


class BeijingClock:
    def __init__(self, now_fn=None):
        self.now_fn = now_fn or (lambda: datetime.now(BEIJING))

    def now(self):
        current = self.now_fn()
        if current.tzinfo is None:
            raise ValueError('时钟必须带时区')
        return current.astimezone(BEIJING)

    def day(self):
        return self.now().date().isoformat()
