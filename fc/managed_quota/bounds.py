"""调用前额度上界。生产路径没有被证明的计数器，因此拒绝。"""

OBSTACLES = (
    'qwen3.7-flash 的最大思维链长度在已读官方页面之间不一致：帮助中心模型页摘要为 131072，百炼控制台模型页为 262144。',
    'QwenCloud 的 max_completion_tokens 写明包含思维链，但同页又写实际输出 token 可能比配置值多至 10；百炼模型页没有核对到同一条硬顶保证。max_tokens 的范围随模型和 thinking_budget 变化，不能当作总额硬顶。',
    '没有与百炼计费一致的调用前计数器，无法证明系统提示、历史、工具、图像、显式缓存创建和隐藏推理的输入 token 上界。',
    '用量对象只在调用返回后出现。不能先调用再发现超额。',
)


class BoundUnavailable(Exception):
    def __init__(self, obstacles=OBSTACLES):
        super().__init__('输入或输出的硬上界尚未被官方证据证明')
        self.obstacles = tuple(obstacles)


def production_bound(_normalized):
    raise BoundUnavailable()


class FixedBound:
    """测试替身。不是生产计数器，也不能拿来打开上游。"""

    def __init__(self, input_tokens, output_tokens):
        self.input_tokens = int(input_tokens)
        self.output_tokens = int(output_tokens)

    def __call__(self, _normalized):
        if self.input_tokens < 0 or self.output_tokens < 0:
            raise BoundUnavailable(('测试上界不能为负',))
        return self.input_tokens, self.output_tokens
