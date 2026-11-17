# AI 学习图谱

[打开图谱](https://passwordis42.github.io/ai-learning-atlas/) · [开始第一天](https://passwordis42.github.io/ai-learning-atlas/#day-1)

这是一份面向零基础学习者的 58 周人工智能路线。40 章分成五个通用阶段和五个方向。方向课附有选学理由，适用于完成通用基础之后。本路线按顺序纳入五个方向，每个阶段都有项目与验收要求。

第一天用一份 10 行 CSV 练习，包含三份文件的角色图、四条记录的逐条演示、可点击术语、保存与运行说明，以及可下载的参考脚本。先保存自己的判断、理由和证据，确认委托范围，再使用 AI。使用在线学伴时，只有主动发送才会把本次问题和当前课程上下文交给所选模型。

第一天之后有 58 节周课和 5 节可选拓展。每课明确谁来做、对什么做、怎样做、做完看到什么。跟完演示，用一份新材料做出实际中间结果，再提交操作记录和两道核对题。反馈并列显示学习者记录与参考过程，每道核对题说明理由。阶段末提供项目步骤和验收要求。站内练习使用例题和小规模模拟，阶段项目可以另外运行真实工具。学习位置、作答和笔记保存在当前浏览器。

## 本地运行

需要 Node.js 22.21 或更新版本，部署流程使用 Node.js 24。

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
```

GitHub Pages 从仓库 Actions 构建 `dist/`。在新仓库的 Pages 设置中将来源设为 GitHub Actions，再推送 `main` 或手动运行发布流程。

## 配置 AI 学伴

GitHub Pages 上可直接复制提示词，交给已有的 AI 聊天工具。要在站内调用模型，可以在本机或自己信任的服务上运行可选的中转服务。

1. 复制 `.env.example` 为 `.env`，按需要填写一组或多组供应商密钥和可用模型名。配置支持 OpenAI、Claude、DeepSeek 和 Qwen。Qwen 的区域与工作空间设置见示例文件。
2. 运行 `npm run tutor`。默认只监听 `127.0.0.1:8787`。用 `npm run dev` 打开本地网页时，可在学伴里用默认地址检查连接。
3. 如果从 Pages 访问，配置 `TUTOR_ALLOWED_ORIGINS=https://passwordis42.github.io`，并为中转服务生成独立的 `TUTOR_ACCESS_TOKEN`。在网页的连接设置中填写受信任的服务地址和中转访问口令。外网地址须使用 HTTPS，本机可用 `http://127.0.0.1:8787/api/tutor`。浏览器可能会要求允许网页访问本机服务。

供应商密钥只存放在本机或服务端的环境变量里。中转口令仅保留在当前页面内存中。接口测试使用模拟响应，无需供应商密钥或付费调用。

官方接口文档：[OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Claude Messages](https://platform.claude.com/docs/en/api/messages/create) · [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) · [Qwen OpenAI 兼容接口](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)

## 用于下一门课程

新课先交代对象从哪里来、谁对它做什么、做到什么状态才能继续、去哪里核对结果。术语首次出现先给白话或例子，正式说明放进可关闭的气泡。练习先示范一次，再请学习者预测、操作和对照结果。周计划引入新工具前，先安排一个手算或可观察的例子。

课程数据位于 `src/data/course.js`。每门课程可以沿用阶段、周安排、资源、实践项目和验收的结构。用章节 `requires` 写前置关系，给选学章节和阶段写出具体理由。课程首页和第一天练习可以沿用页面结构，按主题替换交互和视觉。新课程放在独立仓库时，更新网站名称、页面链接和浏览器进度键。

结构参考本机的 `game-design-atlas` 课程工程，包括周计划、证据记录和先判断后使用 AI 的学习流程。分步讲解、站内动手任务和理解检查参考 [nmr-from-zero](https://github.com/passwordis42/nmr-from-zero)。前端构思参考 [roadmap.sh 的可点击路线](https://roadmap.sh/about) 和 [Starlight 的分组导航](https://github.com/withastro/starlight)，可交互图谱使用 [React Flow](https://github.com/xyflow/xyflow)。
