# 四家供应商的本机配置

只覆盖已经存在的 AI 学伴和游戏助手。核磁没有模型后端，保持复制提问。设置页视觉还没到，这一轮只有接口，没有新的设置画面，也没有从旧 `.env` 导入。

Hub 只监听 `127.0.0.1`。下面的接口还要求 Host 是 `localhost`、`127.0.0.1` 或 `::1`，不发送 CORS 头，也不接受查询串。

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/assistant-config` | GET | 公开视图。含 `apiKeyConfigured`，不含密钥或访问口令 |
| `/api/assistant-config` | PUT | 请求体必须有 `save: true` 才写入。省略 `apiKey` 会保留原密钥 |
| `/api/assistant-config/clear` | POST | `confirm` 必须是 `clear-assistant-configuration`。否则 400，并在 `effect` 说明尚未删除 |
| `/api/tutor` | GET、POST | 进程内 AI 学伴。协议、口令和上下文仍是原实现 |
| `/api/status` | GET | 进程内游戏助手状态。`configured` 和展示用模型，没有密钥 |
| `/api/assist` | POST | 进程内游戏助手。未配置时 503「这个 AI 服务还未在本地配置。」 |

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

自定义地址必须通过 `server/safe-upstream.mjs`：非本机用 HTTPS，不能带账号、查询串或片段，拒绝内网、链路本地和元数据地址。主机名会做 DNS 解析，任一结果落在内网就拒绝。官方默认主机不改写成用户输入。

状态、公开配置和日志都不包含密钥。清除后，AI 和游戏在再次保存前都不能调用模型；核磁不受影响。
