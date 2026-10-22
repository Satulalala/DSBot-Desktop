# DSBot 桌面端

简体中文 · [English](README.en.md) · [下载 v1.0.6](https://github.com/Satulalala/DSBot-Desktop/releases/tag/v1.0.6)

DSBot 桌面端为 Windows 上的 QQ AI 群聊机器人提供本地控制台。它把 DeepSeek Harness（DSH）、SnowLuma（OneBot v11 QQ 网关）和 QQ Bridge 的启动、状态查看、机器人配置与角色卡管理集中到一个桌面应用中。

## 项目截图

![DSBot 本机服务状态页](assets/screenshots/service-status.png)

*服务状态页示意图。截图中的服务状态和端口均为演示数据，不代表真实运行状态。*

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/role-cards.png" alt="按 QQ 会话切换角色卡" width="100%"></td>
    <td width="50%"><img src="assets/screenshots/role-editor.png" alt="Markdown 角色卡编辑器" width="100%"></td>
  </tr>
  <tr>
    <td align="center">按会话选择人格；切换后为该会话开启新的 DSH 会话。</td>
    <td align="center">直接编辑角色卡 Markdown 设定。</td>
  </tr>
</table>

## 项目组成

~~~text
QQ 群聊 / 私聊 ⇄ SnowLuma ⇄ QQ Bridge ⇄ DeepSeek Harness Agent
                              ⇅
                         受限 MCP 工具

DSBot 桌面端 ── 管理本机服务启停、状态、参数、日志和角色卡
~~~

桌面端负责启动和查看本机服务；QQ Bridge 负责把 QQ 消息路由到对应的 DSH 会话，并将 Agent 的回复或交互结果送回 QQ。SnowLuma 是独立组件，需由使用者单独安装和登录。

## 主要功能

### 桌面管理

- 定期检查 DSH、SnowLuma 和 QQ Bridge 的本机服务端口响应，并提供启动缺失服务的入口。
- 打开 SnowLuma 页面、机器人参数设置和运行日志。
- 安装包内置 Node.js、DSH、QQ Bridge 及其运行依赖。

### QQ 会话与角色卡

- QQ 群聊和私聊分别映射到独立的 DSH 会话。
- 角色卡按 QQ 会话保存；切换角色时归档旧 DSH 会话，并为当前会话创建新会话。
- 在桌面角色卡页面查看并编辑 Markdown 设定。
- 支持群聊引用回复、Agent 提问和工具审批等往返交互。

### Bridge 能力

- 通过 OneBot v11 接收 QQ 事件，并把消息交给 DSH Agent 处理。
- 提供受限的 MCP 工具，用于查看授权范围内的群聊信息和消息，并按配置发送、引用回复或互动。
- 提供聊天和仿真群友等运行模式；主动发言、等待和潜水行为取决于所选模式及 DSH Agent 设定。
- 包含群聊话题、成员印象、网络用语和表情包等辅助能力；具体行为受配置、依赖和当前运行模式影响。

## 安装与首次启动

1. 从 [v1.0.6 Release](https://github.com/Satulalala/DSBot-Desktop/releases/tag/v1.0.6) 下载 Windows 安装程序并安装。
2. 首次启动时选择本机已安装的 SnowLuma 文件夹；该项目不会把 SnowLuma 服务本体打包进安装器。
3. 在 SnowLuma 中登录 QQ，并确认 OneBot v11 WebSocket 与 HTTP API 已配置。
4. 在桌面端查看服务状态，按需要填写机器人参数、授权名单和 DSH 模型配置。
5. 从菜单 **DSBot → 角色卡切换…** 为 QQ 会话选择或编辑角色卡。

升级时保留当前 Windows 用户的 DSBot 桌面端应用数据目录。该目录保存桌面端设置、Bridge 配置、会话状态和角色卡；SnowLuma 自身的登录与运行数据由 SnowLuma 管理。

## 从源码构建

需要 Windows x64 和 Node.js 22.13 或更新版本。克隆项目后进入桌面端目录运行：

~~~powershell
git clone https://github.com/Satulalala/DSBot-Desktop.git
cd DSBot-Desktop
cd desktop-app
npm install
npm run make
~~~

运行时准备脚本会下载并校验 Node.js 官方发行包，再将 DSH、QQ Bridge 生产依赖和许可证文件加入桌面安装包。SnowLuma 仍需单独安装。

## 安全与已知限制

- 首次接入真实 QQ 前，请检查 allow/deny 名单、管理员 QQ、运行模式和 Agent 工具权限。不要把机器人连接到未授权的群或账号。
- 配置、QQ 登录信息、会话状态和日志属于本机数据；仓库不应提交 config.json、state、凭据或运行日志。公开仓库只提供示例配置。
- 服务状态页通过本机端口响应辅助判断服务状态；端口有响应不等同于已验证进程版本、配置或账号登录状态。异常时请结合运行日志核对。
- 图片等附件的可识别内容受 OneBot 事件数据、Bridge 处理路径和 DSH 模型能力影响；部分路径会以占位文本形式传递。
- SnowLuma 服务本体及第三方依赖分别遵循各自许可；安装包附带相关许可文本和依赖声明。

## 项目文档

- [Bridge 架构、运行模式与配置说明](docs/QQ-BRIDGE.md)
- [项目技术指南与数据流说明](docs/PROJECT_GUIDE.md)
- [DSH 配置指南](docs/DSH_SETUP.md)
- [桌面端使用说明](desktop-app/README.md)

## 项目结构

~~~text
desktop-app/       Electron 桌面端、角色卡页面、运行时打包脚本
src/               QQ Bridge、DSH 客户端、安全 MCP 与消息处理
dsh/               DSH Agent preset
roles/             角色卡 Markdown 文件
docs/              架构、配置和运维文档
assets/            项目截图
config.example.json 示例配置；真实配置不应提交
~~~

## 许可与免责声明

Bridge 代码以仓库根目录的 MIT License 为准；桌面端及第三方运行时组件的许可说明见各自目录。DSBot 与 SnowLuma、腾讯/QQ 或 DeepSeek 均无隶属关系。使用者需遵守 QQ 平台规则和相关组件许可。
