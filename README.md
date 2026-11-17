# learning-hub

统一学习入口：AI Learn、NMR Learn、Game Learn，支持后续扩展。

界面仍在设计。这个仓库把三门课的源码快照放在独立目录里，并用一个本地入口提供它们。来源提交、改动和限制见 [MIGRATION.md](MIGRATION.md)。

需要 Node.js 24。

```sh
npm ci
npm run install:sites
npm test
npm run build
npm run serve
```

默认地址是 <http://127.0.0.1:8080/>。要挂到前缀下，构建和启动使用同一个 `HUB_BASE`：

```sh
HUB_BASE=/learning-hub/ npm run build
HUB_BASE=/learning-hub/ npm run serve
```

浏览器回归（桌面 1280×800、手机 390×844，根路径和 `/learning-hub/`）：

```sh
npm run test:integration
```

可选的 AI 学伴和游戏助手仍在各自目录里单独启动，密钥只放在不提交的本地 `.env`。入口进程不会保存或转发密钥。
