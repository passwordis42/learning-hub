# v6 内容与真实节选出处说明

## 先说明边界
本轮没有重新读取真实仓库、没有迁移或创作任何教学正文，也没有进行网上内容研究。阅读页是**阅读排版预览**，而非已完成的课程学习系统。界面显式注明“教学全文尚未迁入”。

## 实际使用的内容
- `data/portal.json` / `portal.js`：逐字复制v5，并以字节比较检查。课程title、short、fullName、repo、site，以及每个模块id/title/group/url/note均来自该数据，不补造章节或链接。
- `assets/model.js::descriptions`：沿用v5门户整理导读。它们不是课程原文；阅读页“门户导读，非课程原文节选”明确区分，不给整理文案套原文引号。
- `lesson-note`：只在当前模块有note时显示`入口说明`，逐字保留note。没有note就不显示，不用假正文补高度。
- `同组章节`：从当前真实模块group筛选、排除自身、显示至多三条，其余通过章节目录查看；没有先修含义。
- 原站入口：直接沿用模块url与课程site/repo；待Web提供迁移地址后再替换，不猜learning-hub路由。

## 三课程对应与默认示例
| 状态 | 本地定位 | 真实原站入口 |
|---|---|---|
| AI 第一天 | `courses[id=ai].modules[id=ai-day1]` | https://passwordis42.github.io/ai-learning-atlas/#day-1 |
| NMR 阶段一 | `courses[id=nmr].modules[id=nmr-s1]` | https://passwordis42.github.io/nmr-from-zero/#/learn/1-1 |
| GAME 长标题 | `courses[id=game].modules[id=game-p4]` | https://passwordis42.github.io/game-design-atlas/#plan/16 |
| GAME 实验入口说明 | `courses[id=game].modules[id=game-lab-loop].note` | https://passwordis42.github.io/game-design-atlas/ |

注意：上表最终URL以数据断言为准；部分阶段/实验没有单独深链，沿用已有入口与note说明，不伪造能直达本地全文的路由。

## 美术与样式不是教学数据
- 三座设施与新增四座自然预留岛均为本地原创SVG，不复用Townscaper资产。
- 阅读页的设施小景标注“设施示意 · 非教学数据”；不画伪NMR曲线、真实值、AI得分或玩法成果。
- 本轮选择完整设计“真实教学/实验入口”组件，未摆放虚构CSV脚本或实验正文来填版面。代码块/图表可在真实正文接入后按设计规范扩展，不能先把占位伪装课程。
- 未开发岛没有学科、上线日期或可进入链接；3→10→30仅是明确的增量布局演示。

## 历史来源
`SOURCE-HISTORY.md`原样保存之前版本的只读来源记录，其中数量/章节描述是当时资料，不作为本轮重新核验后的最新事实，也不在首页强调。
