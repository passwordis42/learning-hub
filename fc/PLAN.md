# 受管 AI 额度内核

读取日期：2026-11-18（北京时间）。这是代码和本地 mock，不是资源开通，也不是生产验收。

## 结论

生产默认返回 `UPPER_BOUND_UNPROVEN`，不向上游发包。环境变量 `MANAGED_CHARS_PER_TOKEN` 不能把字数变成 token 上界。SQLite 只验证状态机，**不是**表格存储适配通过。

模型意图仍是百炼 `qwen3.7-flash`。没有改用 `qwen-plus`，也没有自选快照。硬额度只记本站准入日，界面文案写明这不是百炼账户的自然日总额。

## 接入

采用公开函数计算入口，在应用里做匿名会话和原子限流。不引入收费 API 网关，不加登录。函数计算 HTTP 事件使用内置运行时 v1：`version`、`requestContext.http`、`body`、`isBase64Encoded`。来源地址只用 `sourceIp`。`X-Forwarded-For` 不参与分桶，IPv6 文本不做压缩或和 IPv4 合并。

Python 运行时标识见[运行时介绍](https://help.aliyun.com/zh/functioncompute/runtime-intro)：`python3.12`、`python3.10`。本机测试使用 Python 3.12.3。真实函数计算运行时 **NOT TESTED**。

## 账本

表格存储局部事务是候选，不是已接通的适配。2026-11-18 读到的 Python SDK 签名是 `start_local_transaction(table_name, key)`、`commit_transaction(transaction_id)`、`abort_transaction(transaction_id)`，同一分区键内的读写一起提交或丢弃，最长 60 秒、写入不超过 4MB。建议主键固定 `siteId`，再用 `GLOBAL`、`DAY#日期`、`REQ#会话#幂等键` 区分，避免按日期拆成分区后跨日幂等无法同事务完成。

还缺、因此适配器一构造就拒绝的证据：

- 未在本仓库安装或调用该 SDK，没有真实表。
- `start_local_transaction` 超时后，服务端可能已经建好事务；读到的说明是等待超时后再建，没有证明可以用事务号查询 commit 是否已经生效。
- 已有表要开局部事务，文档写的是提交工单，不是已完成的配置。
- 写 CU、存储和公网下行的账号报价没有核到，不能把“有事务”写成“硬额度已经成立”。

状态机在本地事务里验证：`RESERVED`、`DISPATCH_COMMITTED`、`SETTLED`、`RELEASED`、`UNCERTAIN`、`CONSERVATIVE_SETTLED`、`BREACH`。日账保持 `U` 与 `H`。只有还在 `RESERVED` 时才能退回。发权提交之后不重发、不因超时或断连退额。可信 usage 只按 `prompt_tokens + completion_tokens`，并用 `total_tokens` 核对；思考和缓存细项不另加。`A > R` 时记下真实 `A` 并熔断，不把数字截断成 `R`。幂等墓碑和未决账不随 7 日运行日志删除。

## 限流初值

会话 6 次/分钟、并发 1；来源地址 20 次/分钟、并发 2；全站 30 次/分钟、并发 4。请求体 64KiB，用户文本 8000 字符。这些是可调初值，不是压测结论。匿名会话只证明持有这一次标记，不证明真人，也不能防止耗尽全站额度。

## 入口

| 入口 | 处理 |
| --- | --- |
| AI 导师嵌入提问 | `POST /api/ai/requests`，`entry=ai` |
| 游戏助手提交 | 同一接口，`entry=game` |
| NMR | 仍是复制提问，不新增模型调用 |
| `/api/tutor`、`/api/assist` | 原有本地未配置检查还在，课程按钮不再走它们，也不再直连供应商或自定义 URL |

## 费用（不默认已有模型 Key 已包含）

- 函数计算按 CU 计活跃资源、调用和空闲实例；公网出流量在 CDT 另计。帮助中心折扣列的结束日是 2026-08-27，早于这次阅读，不引用为当前价格。
- 表格存储的读写 CU、存储和事务的 Start/Commit/Abort 另计，不能和函数计算的 CU 抵扣。
- 百炼 `qwen3.7-flash` 在已读价格页里，华北2（北京）有条件免费额度，其他地域写明没有；有效期和开通条件以账号为准。思考按输出计。这不覆盖函数计算、CDT、表格存储、日志和域名。
- 100 万 token 不是人民币预算，也不是每天赠送。

## 未实测

真实函数计算、表格存储、百炼模型和任何云资源都 **NOT TESTED**。没有创建资源，没有部署，没有使用真实 Key。本地 mock 通过不能当作生产验证。

## 仍待许可或补证

输入整请求的计费硬上界；输出误差是否适用于选定地域和协议的同一配置；账号地域、RAM、域名备案和网络；表格存储热点与 commit 超时恢复；是否另保留独立私人模式。熔断之后不能靠开关重新放行。
