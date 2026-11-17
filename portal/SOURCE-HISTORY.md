# 教学仓库门户 · 真实来源

检索日期：2026-11-17。只读 GitHub，未 clone、未改仓库、未公开发布。

医生已确认就是这三座仓库，不再另行搜索。以下来源与该指定一致。



检索清单来自 `search_repositories q=user:passwordis42`（17 个仓库）的原始 JSON。医生所说「AI、NMR、GAME」三个教学仓库的名称并不等于仓库全名，按描述与 README 核对后对应如下。

## 对应关系

| 医生所称 | 仓库 full_name | 默认分支 | 仓库页 | 发布的教学内容 |
|---|---|---|---|---|
| AI | `passwordis42/ai-learning-atlas` | main | https://github.com/passwordis42/ai-learning-atlas | https://passwordis42.github.io/ai-learning-atlas/ |
| NMR | `passwordis42/nmr-from-zero` | main | https://github.com/passwordis42/nmr-from-zero | https://passwordis42.github.io/nmr-from-zero/ |
| GAME | `passwordis42/game-design-atlas` | main | https://github.com/passwordis42/game-design-atlas | https://passwordis42.github.io/game-design-atlas/ |

仓库描述（检索结果原文）：

- ai-learning-atlas：AI 学习图谱 · 40 章路线、第一天实操与多模型学伴
- nmr-from-zero：nmr 教学
- game-design-atlas：交互式 PC 游戏设计学习图谱：28 周课程、玩家研究练习和 AI 设计评审。

## 读过的文件（只读）

每个仓库至少读了 README 与根目录，并再读课程数据或路由，用来提取可链接的模块，而不是猜测内容。

- AI：`README.md`、根目录、`src/`、`src/data/course.js`、`src/App.jsx`（确认页面哈希）
- NMR：`README.md`、根目录、`src/content/`、`src/content/course.ts`（阶段与课名）、`src/content/labGuides.ts`（实验名）、`src/App.tsx`（确认哈希路由）
- GAME：`README.md`、根目录、`docs/`、`docs/data/curriculum.js`（阶段与 28 周）、`docs/app.js` 与 `docs/graph.js`（确认 `#plan/01` 等）、`docs/labs.js`（实验名称；未发现独立公开哈希，故实验只作内容说明，入口链到已确认的学习页）

## 主题摘要（据 README，不扩写）

**AI 学习图谱**  
面向零基础学习者的人工智能路线。40 章分成五个通用阶段和五个方向；方向课附选学理由，在完成通用基础之后选用。第一天用一份 10 行 CSV 练习（保存判断、理由和证据后再使用 AI）。站内有可点击图谱与可选的多模型学伴。本机进度保存在浏览器。

已确认链接：

- 图谱总览 https://passwordis42.github.io/ai-learning-atlas/#map
- 第一天课程 https://passwordis42.github.io/ai-learning-atlas/#day-1
- AI 学伴 https://passwordis42.github.io/ai-learning-atlas/#tutor

`course.js` 中的五个基础阶段：会读、会跑、会改；会判断模型有没有用；看懂深度学习和大模型；做一个能查资料的 AI 工具；让别人用得起来。五个方向（可选）：视觉、语音与多模态；大模型训练与对齐；搜索、推理与规划；强化学习与机器人；时间序列、图学习、因果与研究。页面哈希只识别 `map` / `day-1` / `tutor`，阶段没有单独确认的深链，门户里阶段名链到图谱总览。

**从零看懂核磁共振**  
中文零基础交互教材：12 个阶段、36 节课、8 组在浏览器本地计算的教学实验。路线从电磁感应与相位，走到自旋、射频激发、弛豫、接收、空间编码、图像重建和真实仪器搭建。另有硬件工坊、开源项目审计、整机地图、资料库和术语表。网页仿真用于建立物理直觉，不是人体扫描方案，也不是可直接加工的工程设计。

已确认链接（哈希路由）：

- 学习路线 https://passwordis42.github.io/nmr-from-zero/#/path
- 课程 ` #/learn/{课号}`，例如第一课 https://passwordis42.github.io/nmr-from-zero/#/learn/1-1
- 实验 ` #/labs/{id}`（waves / spin / relaxation / sampling / field / coil / timing / imaging）
- 硬件工坊 https://passwordis42.github.io/nmr-from-zero/#/build
- 开源项目审计 https://passwordis42.github.io/nmr-from-zero/#/projects
- 整机地图 https://passwordis42.github.io/nmr-from-zero/#/hardware
- 资料库 `#/resources`，术语表 `#/glossary`

12 个阶段名见 `course.ts`，例如「认识整台仪器」「把核磁变成空间成像」「走向整机搭建与调试」。

**游戏设计学习图谱**  
28 周 PC 游戏设计课程，含站内分步教材、带反馈的小测、5 种浏览器实验、四个完整项目和八类玩法练习。强调访谈、试玩和证据分析；另有 AI 学习工坊与仓库内《AI 开发守则》。GitHub Pages 从 `docs` 提供课程。

已确认链接：

- 学习网站 / 图谱 https://passwordis42.github.io/game-design-atlas/ （路由默认 `graph`）
- 周次正文 https://passwordis42.github.io/game-design-atlas/#plan/01 至 `#plan/28`（周次号两位）
- 五个阶段（curriculum.js）：拆解与假设；机制与数值；关卡与体验；品类实验；试玩版交付
- AI 开发守则 https://github.com/passwordis42/game-design-atlas/blob/main/AI-DEVELOPMENT.md

`labs.js` 中的五实验名称：给两条路线跑一遍规则；六回合供电台；比较原版路口和地标版；跳跃容错试验台；用漏斗定位上手障碍。未在路由代码中找到可单独打开的公开哈希，门户不编造实验深链，只把名称作为该课已有模块列出，并链到学习网站。

## 未选用、避免混淆的仓库

同一账号下还有其他相关仓库，但与「三个教学仓库 AI / NMR / GAME」的对应不成立，未写入门户课程：

- `ai-video-viz-p0`：AI 视频 P0 轻量知识可视化，不是 AI 学习图谱本课
- `NeronNetRectangle`：交互式神经网络教学演示，独立小实验，不是该 AI 图谱仓库
- `Aura`、`GameplayAbilitySystem_Aura`：UE5 GAS 学习项目，不是 game-design-atlas
- 其余为产品、游戏或工具仓库，不是这次要统一的教学门户对象

若之后要把它们收进门户，应按「未来可扩展」通过配置追加，而不是改写成已经上架的第四门课。

## 门户如何使用这些来源

`data/portal.js` 与 `data/portal.json` 只收录上面确认过的标题、简介、模块名和 URL。不编造师资、成绩、学习人数或已完成章节数。课程结构中的「36 节 / 28 周 / 40 章」是仓库对自己教材体量的说明，不是学习进度。
