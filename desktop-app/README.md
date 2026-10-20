# DSBot 桌面端

面向 Windows x64 的桌面端，当前应用版本为 **1.0.6**。

## 本版本内容

- 服务状态页可查看 DeepSeek Harness、SnowLuma 和 QQ Bridge 的运行情况，并启动未运行的本机服务。
- 可按 QQ 会话选择角色卡；切换后会归档旧 DSH 会话并为该会话创建新的 DSH 会话。
- 角色卡页面支持编辑 Markdown 设定。
- 同一会话重复出现 Agent 处理错误时，错误提醒增加 5 分钟冷却，减少群内刷屏。

## 安装与首次启动

1. 使用 `make\squirrel.windows\x64\DSBot 桌面端-1.0.6 Setup.exe` 安装，或运行完整解压目录中的 `DSBotDesktop.exe`。便携运行时请保留整个文件夹，不要单独移动 exe。
2. 首次启动时选择本机已安装的 SnowLuma 根目录；该目录必须包含 `index.mjs`。
3. 在 SnowLuma 中登录 QQ。回到桌面端服务状态页，确认 SnowLuma 和 QQ Bridge 已连接。

桌面端内置 Node.js、DeepSeek Harness、QQ Bridge 和所需运行依赖。**SnowLuma 本体需要单独安装**，不会随本包复制或安装。

## 角色卡

从窗口左上角 **DSBot → 角色卡切换…** 打开角色卡页面。先选 QQ 会话，再选角色卡；需要调整设定时使用卡片上的编辑入口。角色卡正文以 Markdown 保存。

## 数据与升级

- 登录信息、桌面端设置、机器人配置、会话状态和角色卡保存在当前 Windows 用户的 Electron 应用数据目录中；运行时按应用版本放在 `bundled-runtime\1.0.6`。
- 桌面端使用自己的桥接数据目录，不会自动导入旧版独立 QQ Bridge 的配置。升级时请保留应用数据目录；删除它会同时删除本机配置和会话数据。
- SnowLuma 安装路径保存在桌面端设置中。重新安装或更换 SnowLuma 目录后，可从启动页重新选择。

## 发布文件

- `make\squirrel.windows\x64\DSBot 桌面端-1.0.6 Setup.exe`：Windows 安装程序。
- `DSBot 桌面端-win32-x64\`：解压运行目录，必须整体保留。
- 本文件：安装、首次启动、角色卡和本地数据说明。

## 从源码构建

在 Windows x64 环境中进入 `desktop-app` 目录，运行：

```powershell
npm install
npm run make
```

运行时准备脚本会下载并校验 Node.js 官方压缩包，再打包 DSH、QQ Bridge 生产依赖和许可证文件。
