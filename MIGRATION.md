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
- `PUT /api/assistant-config` 只有请求体包含 `save: true` 才写入。地址没有变化时，省略某个 `apiKey` 会保留已保存的密钥。共用地址、课程覆盖、通义地区或工作空间一旦改变，必须重新输入密钥，或明确确认清除该厂商密钥。空密钥不会被发到新的上游。
- 助手接口需要本进程管理会话。浏览器从入口页面打开时获得 Cookie；会话不写进静态资源。跨站来源会被拒绝。
- `POST /api/assistant-config/clear` 只有 `confirm` 等于 `clear-assistant-configuration` 才删除文件，并说明这会让 AI 学伴和游戏助手在再次保存前无法调用模型，核磁不受影响，也不会读取或迁移旧 `.env`。
- 四家供应商共用各自的地址和模型。AI 与游戏协议路径不同，所以 OpenAI 仍分别走 Responses 和 Chat Completions。某一侧没有显式模型时，不会把密钥交给那一侧，因此游戏的 `gpt-4.1-mini` 等默认模型不会套到 AI。
- 自定义上游先做 SSRF 校验：地址规范成二进制后再分类，映射 IPv6、私网、保留、回环、未指定、整段 `fe80::/10`、ULA 和组播都拒绝。公网地址可以连接。DNS 的每条答案和实际连接用同一规则，拒绝时不建立 TCP，重定向不跟随。
- 配置文件默认是 `server/secrets/assistant-config.json`，权限 `0600`，已被 gitignore。可用 `ASSISTANT_CONFIG_PATH` 改位置。hub 不读取 `sites/*/.env` 或进程里的密钥环境变量。
- 游戏页在本机打开时请求同源 `/api/status` 和 `/api/assist`，并只在同源时附带会话。未配置时返回原来的 503「这个 AI 服务还未在本地配置。」状态响应不含密钥。独立站或指向其他源的地址使用 `credentials: omit`，不发送 hub 会话。
- 嵌入阅读里的 AI 学伴自动使用同源 `/api/tutor`（含 `/learning-hub/` 前缀），并附带本站会话。独立打开 AI 站点时仍要手填地址；外部地址不附带会话。核磁仍只复制问题。
- 「测试已保存配置」只核对已保存的密钥和模型，不向上游发送请求，结果不能写成服务可达。

本次浏览器回归使用本机模拟上游，不使用真实供应商。真正的模型回复和付费调用没有验证。过短的访问口令返回 400，页面可以修改后重试。

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

GitHub Pages 构建可以写入一份公开的百炼默认配置。仓库 secret 名是 `LEARNING_HUB_PUBLIC_BAILIAN_KEY`，只在 Actions 构建时读入，不提交到 git，构建日志不打印它。可选变量是 `LEARNING_HUB_PUBLIC_BAILIAN_REGION`、`LEARNING_HUB_PUBLIC_BAILIAN_MODEL`、`LEARNING_HUB_PUBLIC_BAILIAN_WORKSPACE`。地区留空时使用已确认的北京，对话地址是 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，不会向其他地区试密钥。模型留空时使用 `qwen3.7-flash`，并标明未经验证、尚未连接。没有这个 secret 时助手暂不可用，不打开配置页。访客看不到网络配置入口。产物里的密钥是公开的，隐藏页面不是保密，也不是防刷。

`npm test` 包含快照哈希、存储键审计、入口路由、助手配置、百炼列表地址、公开默认配置和上游地址测试，以及三个目录原来的测试。`test:integration` 会按 `/` 和 `/learning-hub/` 分别构建，再用本机 Chrome 检查桌面、390 宽和 360 宽。它会操作核磁测验与实验、游戏周次实验、统一入口里的 AI 学伴，以及助手设置的保存、未保存确认和按厂商清除。保存只写入页面内存，不调用外部模型。

本地预览：

```sh
npm run build
npm run serve
```

浏览器打开 `http://127.0.0.1:8080/`。带前缀时先 `HUB_BASE=/learning-hub/ npm run build`，再 `HUB_BASE=/learning-hub/ PORT=8080 npm run serve`，打开 `http://127.0.0.1:8080/learning-hub/`。

## 首页与阅读

v6 群岛首页在 `portal/`。目录来自三门课的真实课节，链到本地地址。阅读区去掉课程外框，正文仍是原模块，和页面一起滚动。对照见 `FEATURE-MAP.md`。助手字段见 `API-FIELDS.md`。字体是 SIL OFL 的 Noto Sans SC 400/700 与 Noto Serif SC 400 全量分片，不再使用只覆盖设计稿的子集。

## 限制

- 构建和 `npm run serve` 必须使用同一个 `HUB_BASE`。NMR 的资源前缀在构建时写入 CSS 和 HTML。
- 默认仍只监听 `127.0.0.1`。这不是已经可以公开部署的生产入口。远程模式必须显式设置 `HUB_EXPOSURE=remote`，并同时具备管理口令、HTTPS 源、允许的主机和受信任的反向代理；匿名请求不能改配置或调用已保存的密钥。部署前提写在 `deploy/README.md`。这次没有实际部署。
- 没有从旧 `.env` 导入或自动迁移密钥。没有账号系统，也没有云同步。
- 旧源站的 `localStorage` 不会迁移。
- 外部模型调用、已配置密钥时的助手回复，以及 AI 学伴在浏览器里的真实提问，这次没有运行。
