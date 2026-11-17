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

发布用的页面是静态文件。AI 学伴和游戏助手共用助手设置里的地址、模型和密钥，由浏览器直接请求用户填写的供应商；核磁仍只复制问题。密钥只留在这次打开的页面内存里，刷新或关闭后消失，不写入浏览器存储，也不送到本站服务器。页面不会读取或迁移旧的后端密钥。GitHub Pages 工作流见 `.github/workflows/pages.yml`，目标前缀是 `/learning-hub/`；这个文件已经写好，但没有启用 Pages，也没有触发发布。细节见 [deploy/README.md](deploy/README.md)。
