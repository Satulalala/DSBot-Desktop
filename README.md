# DSBot 桌面端

面向 Windows 的 Electron 桌面程序，用于启动本机 DeepSeek Harness（DSH）与 QQ Bridge、查看运行状态和日志、调整机器人配置，并打开 SnowLuma 的 WebUI。

## 下载和安装

在 [Releases](https://github.com/Satulalala/DSBot-Desktop/releases) 下载 **DSBot 桌面端-1.0.0 Setup.exe** 并运行。首次启动时选择你单独下载并安装的 SnowLuma 文件夹。

安装包内置 Node.js、DSH、QQ Bridge 及其运行依赖。**SnowLuma 服务本体不包含在安装包内**；请从 [SnowLuma 官方项目](https://github.com/SnowLuma/SnowLuma) 单独下载。SnowLuma 的 QQ 登录信息、机器人参数和授权名单保存在本机用户目录，不会预填进公共安装包。

本版本运行时基于 QQ Bridge v0.1.0 与 DSH 0.1.1-rc.2 构建。SnowLuma SDK/MCP 包随 Bridge 作为依赖，并附有对应许可证文本。

## 从源码构建

在 Windows x64 环境中，从项目根目录进入 desktop-app：

```powershell
npm install
npm run make
```

产物位于上级目录的 dist/make/squirrel.windows/x64。运行时准备脚本会下载并校验 Node.js 官方发行包，随后打包 DSH、Bridge 生产依赖和许可证文件。

## 项目来源与许可

- 桥接代码基于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)，许可证见本仓库 LICENSE。
- SnowLuma 服务本体不随本项目分发；SnowLuma 及其 SDK/MCP 的许可证文本见 desktop-app/licenses/snowluma-LICENSE.txt。
- Node.js、DSH 和 npm 依赖的版权与许可证声明随安装包中的 NOTICE.txt 及各依赖文件一并提供。

本项目与 SnowLuma、QQ/Tencent 均无隶属关系。请遵守各组件许可证及 QQ 平台规则。
