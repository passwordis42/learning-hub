# v6 交互与Web交接

## 状态模型
`{view: overview|reader,course,module,focus: overview|courseId,paused,scale:3|10|30,directory,query}`。
`assets/model.js`负责纯状态／真实内容筛选；`assets/site.js`负责DOM与焦点；`harbor.css`是新增视觉层。无运行时外部API、账号、进度存储或假加载。

## 状态矩阵
| 状态／动作 | 场景与视图 | 内容与反馈 | 键盘／手机 |
|---|---|---|---|
| 默认overview | 三座真设施＋四座自然预留岛 | AI第一天导读票／真实原页／阅读预览 | 预留岛不在Tab序，aria说明未开放 |
| 预留岛 | 远近自然地形、勘测／未完码头 | 图例“待开发岛 · 尚未开放” | 非button，无假点击承诺 |
| hover/focus | 地标牌／按钮有反馈 | selected用边框、勾号、文字，不仅颜色 | Tab为3px浅环＋深外环，地标有双框 |
| 聚焦AI/NMR/GAME | 240ms有方向近景 | 只显示当前牌；其他地标pointer/aria/Tab移除 | 顶部三课按钮始终可用；手机独立近景 |
| 选择靠岸站模块 | 不跳外链，不改变镜头 | 真实标题、group、note与链接更新 | 对应分组展开；列表原生滚动 |
| 进入阅读预览 | 世界整体隐藏，显示宽学习页 | 当前课程／模块保留；明确界面原型 | 记住进入前scroll与触发器；聚焦文章标题 |
| 阅读目录选模块 | 侧栏保留，正文替换 | 真标题／导读／note／原页／同组章节更新 | 不重建同课程TOC；标题获焦；手机收起目录 |
| 阅读切课程 | 主题／设施／真实章节一起切换 | 使用新课程真实首条目 | 返回后落在新课程，不丢所选 |
| 打开本节教学原页 | 新标签页真实URL | 深链限制沿用note，不猜本地全文 | aria说明新标签；noopener noreferrer |
| 返回群岛 | 恢复原镜头／当前所选 | 课程与最新模块保留，所选分组展开 | 恢复进入按钮焦点／探索scroll；直接reader URL返回所选近景 |
| 手机目录开合 | 普通文档中展开／收起 | 非全屏抽屉，无固定高锁滚 | aria-expanded；收起隐藏子项Tab |
| 暂停/reduced-motion | 水流、信号与镜头停止 | 导航仍正常 | 常驻页眉；系统静态不可偷偷恢复 |
| 10/30演示 | 预留自然岛仍在，不挤30标签 | 只有三真实课；新增均灰标disabled占位 | 搜索／目录按分组聚合 |
| 长标题／无note／无同组 | 正常换行、正常流 | 无note不显示；同组空态可回目录 | 不省略，不编正文填空 |
| 搜索无结果 | 原世界／阅读状态不丢 | 真实空态与清空操作 | 支持中文IME；不抢候选字 |

## Escape优先级
1 搜索有query先清空；2 已开全文字目录则关闭并返回触发器；3 在reader返回群岛；4 聚焦设施返回总览，焦点回可见世界触发器。阅读中切换课程会把世界回退触发器指向对应世界按钮，避免Esc回到已隐藏的阅读按钮。

## 滚动与焦点约束
- 常规桌面靠岸站：最大850px且受可用视窗控制，章节region有边框／↕提示／常显滚动条预算／10px焦点留边。无wheel或滚动键拦截。
- 短视窗／长note／大字号：单一靠岸站滚动替代内部列表，不嵌套两个滚动区。手机全部恢复normal flow。
- 学习页：正文不限高；桌面侧栏sticky，导航原生滚动。手机目录默认收起，展开后不设max-height/overflow；选模块后聚焦正文标题。
- `open-learning`为稳定DOM，返回不会找一个已被重建移除的按钮。返回也展开当前模块的真实分组。
- 未开发岛无交互入口。只有三座真实设施可Enter/Space／点击，预留岛不伪装禁用课程。

## URL与截图状态（仅127.0.0.1:8770）
- 默认总览：`/index.html` 或 `/index.html?view=overview`
- AI靠岸：`/index.html?view=overview&course=ai&focus=ai&module=ai-day1`
- NMR靠岸：`/index.html?view=overview&course=nmr&focus=nmr&module=nmr-s1`
- GAME长标题靠岸：`/index.html?view=overview&course=game&focus=game&module=game-p4`
- AI阅读：`/index.html?view=reader&course=ai&module=ai-day1`
- NMR阅读：`/index.html?view=reader&course=nmr&module=nmr-s1`
- GAME长标题阅读：`/index.html?view=reader&course=game&module=game-p4`
- GAME实验真实note：`/index.html?view=reader&course=game&module=game-lab-loop`
- 空结果：`/index.html?directory=1&q=__no_match__`
- 30项：`/index.html?scale=30&directory=1`
- 双画板：`/review.html?view=overview`、`/review.html?view=reader&course=nmr&module=nmr-s1`；支持上述所有query。裁切`#desktop-board`／`#mobile-board`。

## 实测辅助（交主代理浏览，不是已浏览通过）
等240ms镜头过渡后：
```js
ATLAS_QA.bounds()   // overview检查真实标牌rect；reader返回worldHidden
ATLAS_QA.scroll()   // 靠岸站章节容器
ATLAS_QA.learning() // reader/课程/模块/横向溢出/隐藏焦点/导航overflow
ATLAS_QA.snapshot()
```
`checks/camera-bounds.json`是数学投影，不是DOM测量。LinkeDOM测试的几何全部stub，不能代替上述真实浏览检查。

## 给Web的边界
此轮等医生审，不落地真实仓库。模块数据与链接完整保留，当前阅读只提供真实元信息／整理导读／note／入口，不是完成全文迁移。后续接入真实正文才添加代码执行、实验操作、数值图表等；不能把设计示意解释成已可学习全部内容。新增真实课程应注册主题／设施／镜头边界；新增导航与搜索继续数据驱动，不能硬挤30个牌。
