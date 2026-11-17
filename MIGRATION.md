# 迁移说明

## 来源快照

复制时去掉 `.git`、`node_modules`、`dist` 和真实 `.env`。`.env.example`、README、测试、课程资源和上游工作流文件一并保留。上游工作流位于 `sites/*/.github/workflows/`，GitHub 不会执行嵌套工作流。本仓库没有部署工作流。

| 目录 | 上游 | 精确提交 |
| --- | --- | --- |
| `sites/ai-learning-atlas` | https://github.com/passwordis42/ai-learning-atlas | `1b325e33b8c75bc3252303279a0299817027e27d` |
| `sites/nmr-from-zero` | https://github.com/passwordis42/nmr-from-zero | `b10355f6f1387f17089d1e22229353589901ac75` |
| `sites/game-design-atlas` | https://github.com/passwordis42/game-design-atlas | `f0cefba298cd201b232b570fde5ebe874451c353` |

`provenance/source-manifest.json` 记录每个上游 blob。`npm test` 里的快照检查会重新计算哈希。除下面列出的适配外，文件必须与这些 blob 一致。安装产生的 `node_modules`、构建产生的 `dist`，以及 `tsc -b` 产生的 `tsconfig.tsbuildinfo` 不计入快照。上游 `.gitignore` 已经忽略这些产物。

原仓库、原 Pages 部署和可见性没有改动。

## 目录与路由

```text
public/index.html                 占位入口
server/hub.mjs                    静态服务与本机助手配置
sites/ai-learning-atlas/          独立 lockfile，Vite base 仍是 ./
sites/nmr-from-zero/              独立 lockfile
sites/game-design-atlas/          无依赖、无 lockfile，直接提供 docs/
dist/                             npm run build 生成，不入库
```

入口链接是相对地址 `ai/`、`nmr-from-zero/`、`game/`。默认 `HUB_BASE=/`。设为 `/learning-hub/` 时，同一套相对链接挂在该前缀下。

三门课继续使用各自的哈希路由，因此刷新只请求目录下的 `index.html`：

- `/ai/#week-01`、`/ai/#day-1`、`/ai/#elective-16`
- `/nmr-from-zero/#/learn/1-1`、`#/labs/imaging`、`#/build`
- `/game/#plan/01`、`#graph/01`、`#coach/01`

不带斜杠的站点根会 308 到带斜杠的地址，避免相对资源跑到错误层级。缺少的文件返回 404，不会改写成别的课程页面。`..`、百分号编码和点文件路径不会读到站点目录之外。

## 基础设施适配

只改了 `sites/nmr-from-zero/vite.config.ts`。它通过 `globalThis.process` 读取 `HUB_BASE`，因此原来的 `tsc -b` 不需要新增 `@types/node`。

- 不设置 `HUB_BASE`，或设置为空字符串、`/` 时，Vite `base` 仍是原来的 `/nmr-from-zero/`。在该目录单独执行 `npm run dev` 和 `npm run build` 与上游一致。
- hub 构建会把 `HUB_BASE` 传给它。`/learning-hub/` 会把资源基址写成 `/learning-hub/nmr-from-zero/`，KaTeX 字体随 CSS 走这个前缀。
- AI 的 `base: './'` 和游戏页的相对 URL 不用改，两种前缀都能加载。
- 构建写入 `dist/.hub-base`。启动时如果 `HUB_BASE` 与该文件不一致，进程直接退出，避免用错一套 NMR 资源地址。这个文件不会被静态服务返回。

课程正文、公式、测验、进度结构和测试文件没有改写。

## 存储

三门课在合并到同一源站后仍只使用 `localStorage`。运行时代码里没有 `sessionStorage`、IndexedDB、Cache Storage 或 service worker。键前缀没有重叠，因此没有改名：

- `learning-atlas:` 下的章节、第一天和周课记录
- `nmr-from-zero.progress.v2`，以及只读的旧键 `nmr-from-zero.progress.v1`
- `game-design-atlas:learning:v1`、`game-design-atlas:resume:v1`、`game-design-atlas:experiments:v1`

原来 github.io 源站上的进度仍留在那些源站，没有删除，也不会自动出现在 hub 的源站。换浏览器或换域名后，继续使用各课原有的 JSON 导出和导入。

## 可选模型助手

静态页面不包含 API 密钥。hub 在进程内调用两门课原有的助手实现，不再把请求转发到 8787 或 4173。

- `GET /api/assistant-config` 返回供应商、模型和地址是否已配置，不返回密钥或访问口令。
- `PUT /api/assistant-config` 只有请求体包含 `save: true` 才写入。省略某个 `apiKey` 会保留已保存的密钥。
- `POST /api/assistant-config/clear` 只有 `confirm` 等于 `clear-assistant-configuration` 才删除文件，并说明这会让 AI 学伴和游戏助手在再次保存前无法调用模型，核磁不受影响，也不会读取或迁移旧 `.env`。
- 四家供应商共用各自的地址和模型。AI 与游戏协议路径不同，所以 OpenAI 仍分别走 Responses 和 Chat Completions。某一侧没有显式模型时，不会把密钥交给那一侧，因此游戏的 `gpt-4.1-mini` 等默认模型不会套到 AI。
- 自定义上游先做 SSRF 校验：非本机必须是 HTTPS，拒绝用户信息、查询串、内网和链路本地地址；主机名会解析，解析到内网则拒绝。
- 配置文件默认是 `server/secrets/assistant-config.json`，权限 `0600`，已被 gitignore。可用 `ASSISTANT_CONFIG_PATH` 改位置。hub 不读取 `sites/*/.env` 或进程里的密钥环境变量。
- 游戏页在本机打开时仍请求同源 `/api/status` 和 `/api/assist`。未配置时返回原来的 503「这个 AI 服务还未在本地配置。」状态响应不含密钥。
- AI 学伴页面仍要求填写服务地址。把地址指到本机 hub 的 `/api/tutor` 后，使用同一份已保存配置。生产构建不会自动请求它。核磁仍只复制问题。

本次没有配置真实密钥，也没有调用外部模型。学伴的现有单元测试使用模拟响应。游戏页在助手未配置时会显示需要 API 密钥。真正的模型回复和付费调用没有验证。设置页视觉仍等设计稿，目前只有上述接口。

## 命令

在 Node 24 下：

```sh
npm ci
npm run install:sites
npm test
npm run build
HUB_BASE=/learning-hub/ npm run build
npm run test:integration
npm run serve
```

`install:sites` 只在有 `package-lock.json` 的 AI 与 NMR 目录执行 `npm ci`。游戏课上游没有依赖和 lockfile，测试直接用 Node 内置测试运行器。三套依赖不合并、不升级。

`npm test` 包含快照哈希、存储键审计、入口路由测试，以及三个目录原来的测试。`test:integration` 会按两个前缀分别构建，再用本机 Chrome 检查桌面和手机视口。

## 首页与阅读

v6 群岛首页在 `portal/`。目录来自三门课的真实课节，链到本地地址。阅读区去掉课程外框，正文仍是原模块，和页面一起滚动。对照见 `FEATURE-MAP.md`。助手字段见 `API-FIELDS.md`。字体是 SIL OFL 的 Noto Sans SC 400/700 与 Noto Serif SC 400 全量分片，不再使用只覆盖设计稿的子集。

## 限制

- 构建和 `npm run serve` 必须使用同一个 `HUB_BASE`。NMR 的资源前缀在构建时写入 CSS 和 HTML。
- hub 只监听 `127.0.0.1`。助手配置接口还要求 Host 是本机，并且不返回 CORS 头。
- 没有设置页。没有从旧 `.env` 导入或自动迁移密钥。
- 旧源站的 `localStorage` 不会迁移。
- 外部模型调用、已配置密钥时的助手回复，以及 AI 学伴在浏览器里的真实提问，这次没有运行。
