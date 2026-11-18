class UpstreamClosed(Exception):
    def __init__(self):
        super().__init__('上游调用已关闭')


class ClosedUpstream:
    """生产上游。不创建 HTTP 客户端，不读取密钥。"""

    def __init__(self):
        self.calls = 0

    def complete(self, _payload):
        self.calls += 1
        raise UpstreamClosed()
