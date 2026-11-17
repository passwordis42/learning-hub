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
server/hub.mjs                    静态服务与固定回环代理
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

静态页面本身不代理，也不包含 API 密钥。

- AI 学伴源码仍在 `sites/ai-learning-atlas/server/`。生产构建不会自动请求 `/api/tutor`；页面要求填写服务地址，默认示例是 `http://127.0.0.1:8787/api/tutor`。在该目录复制 `.env.example` 为不提交的 `.env` 后执行 `npm run tutor`。hub 对 `/api/tutor` 返回 404。
- 游戏助手源码仍在 `sites/game-design-atlas/server/`。它只监听 `127.0.0.1`，并只接受本机 Host。在该目录执行 `npm start`，默认端口 4173。
- 浏览器若从 `localhost`、`127.0.0.1` 或 `[::1]` 打开游戏页，课程脚本会请求当前源站的 `GET /api/status` 和 `POST /api/assist`。`npm run serve` 只把这两个精确路径和方法转发到固定的 `http://127.0.0.1:4173`。不接受查询串，不转发 `Authorization`、`Cookie` 或 `Origin`，不使用请求里的地址，不返回上游的 CORS 或 `Set-Cookie`，也不记录请求体。助手没启动时返回 503，页面保持原来的连接失败说明。密钥未配置时，游戏服务返回 503「这个 AI 服务还未在本地配置。」，请求在调用外部模型之前结束。
- 非本机页面仍按原逻辑直接访问 `http://127.0.0.1:4173`，并继续受游戏服务自己的 `TRUSTED_SITE_ORIGIN` 约束。

本次没有配置真实密钥，也没有调用外部模型。学伴的现有单元测试使用模拟响应。游戏页在助手未配置时会显示需要 API 密钥，这个状态被集成测试覆盖。真正的模型回复、口令校验和付费调用没有验证。

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

## 限制

- 构建和 `npm run serve` 必须使用同一个 `HUB_BASE`。NMR 的资源前缀在构建时写入 CSS 和 HTML。
- hub 只监听 `127.0.0.1`。游戏代理的上游固定为 `127.0.0.1:4173`，不能通过请求改成其他地址。
- 旧源站的 `localStorage` 不会迁移。
- 外部模型调用、已配置密钥时的助手回复，以及 AI 学伴在浏览器里的真实提问，这次没有运行。
