# 四家供应商的本机配置

纯静态页面把 AI 学伴和游戏助手的地址、模型和密钥留在这次打开的入口页面内存里，由浏览器直接请求用户填写的供应商。核磁仍只复制问题。不写入浏览器存储，不读取或迁移旧的后端密钥。下面的 `/api/*` 记录的是仓库里仍保留的 Node 进程，不是当前静态发布的默认路径。

默认只监听 `127.0.0.1`。本机模式不是已部署的生产入口。下面的接口在本机模式还要求 Host 是 `localhost`、`127.0.0.1` 或 `::1`。不发送 CORS 头，也不接受查询串。读、写、清除、状态、模型测试，以及会带出密钥的 `/api/tutor`、`/api/status`、`/api/assist`，都要带本进程的管理会话：浏览器从入口页面导航时拿到 `HttpOnly` Cookie，其他客户端使用 `X-Hub-Session`。会话值不写进页面、脚本或仓库。跨站 `Origin` 会被拒绝。

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/assistant-session` | POST | 用管理口令建立会话。本机口令由进程生成；远程模式才使用 `HUB_ADMIN_TOKEN`。响应不回显口令 |
| `/api/assistant-config` | GET | 公开视图。含 `apiKeyConfigured`，不含密钥或访问口令 |
| `/api/assistant-config` | PUT | 请求体必须有 `save: true` 才写入。地址没变时，省略 `apiKey` 会保留原密钥。地址变了则必须重新输入密钥，或带 `confirmKeyBinding: "clear-key-for-new-upstream"` 明确清除 |
| `/api/assistant-config/clear` | POST | `confirm: "clear-assistant-configuration"` 清除全部。`confirm: "clear-vendor-configuration"` 加 `vendor` 只清除该厂商。确认不对时不删除，并说明影响 |
| `/api/tutor` | GET、POST | 进程内 AI 学伴。协议、口令和上下文仍是原实现 |
| `/api/status` | GET | 进程内游戏助手状态。`configured` 和展示用模型，没有密钥 |
| `/api/assist` | POST | 进程内游戏助手。未配置时 503「这个 AI 服务还未在本地配置。」 |
| `/api/assistant-config/test` | POST | `scope: "status"` 只看已保存配置，不调用模型。`scope: "model"` 还要 `confirm: "test-model-usage"`，才会真的请求模型 |

这些路径也挂在 `HUB_BASE` 下面，例如 `/learning-hub/api/tutor`。助手设置页在门户页眉，返回时恢复课程、章节和滚动位置。密钥输入留空表示保留，响应只写「已在后端保存」，不回传密钥。

配置文件默认 `server/secrets/assistant-config.json`（`0600`，已 gitignore），可用 `ASSISTANT_CONFIG_PATH` 更换。hub 不读 `sites/*/.env`，也不读进程中的密钥变量。

## 共用字段和不能合并的差异

每个供应商有自己的 `model`、`baseUrl`、`region`、`workspaceId`。`protocols.ai` 与 `protocols.game` 可以覆盖该供应商的模型和地址。没写覆盖时用供应商自己的值。两侧都没有显式模型时，该侧拿不到密钥。游戏代码里的 `gpt-4.1-mini`、`claude-haiku-4-5`、`deepseek-flash`、`qwen-plus` 因此不会进入 AI。

| 字段 | AI 学伴 | 游戏助手 |
| --- | --- | --- |
| 运行时 id | `openai`、`claude`、`deepseek`、`qwen` | `openai`、`anthropic`、`deepseek`、`qwen` |
| OpenAI 路径 | 共用基址加 `/responses` | 共用基址加 `/chat/completions` |
| Claude | `/messages`，并发送工作空间（若已填） | `/messages`，不发送工作空间 |
| 通义地区 | 保存 `beijing` 等短名，交给 AI 时写成 `cn-beijing` 等 | 使用同一套短名 |
| 访问口令 | 可选，至少 32 位，只交给 AI | 不使用 |
| 请求正文 | `provider`、`question`、`context` | `provider`、`mode`、周次、草案、理由、证据或已确认规则 |

自定义地址必须通过 `server/safe-upstream.mjs`。地址先规范成二进制形式，再判断类别：IPv4 映射的 IPv6（含压缩十六进制和点分形式）按里面的 IPv4 处理；私网、保留、回环、未指定、链路本地 `fe80::/10`、ULA 和组播都拒绝。公网 IPv4 和 IPv6 可以连接。主机名的每一条 DNS 答案以及真正要连接的地址用同一套规则校验，拒绝时不建立 TCP。重定向不跟随。官方默认主机不改写成用户输入。

更换厂商共用地址、按课程覆盖的地址、通义地区或工作空间，都会改变密钥可发往的源。旧密钥不会因为请求里留空而被带到新源。调用 AI 学伴、游戏助手和模型测试前都会再核对绑定；对不上就不附带密钥。

状态、公开配置和日志都不包含密钥。清除后，AI 和游戏在再次保存前都不能调用模型；核磁不受影响。同一操作系统用户如果能读会话文件或伪造浏览器导航，本机模式挡不住；这不是远程部署边界。远程模式见 `deploy/README.md`，必须显式打开，匿名请求不能改配置，也不能拿已保存的密钥去调用模型。
