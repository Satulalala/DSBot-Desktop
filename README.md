<a id="chinese"></a>

# DSBot 桌面端

简体中文 · [English](#english) · [下载 v1.0.6](https://github.com/Satulalala/DSBot-Desktop/releases/tag/v1.0.6)

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

---

<a id="english"></a>

# DSBot Desktop

[简体中文](#chinese) · English · [Download v1.0.6](https://github.com/Satulalala/DSBot-Desktop/releases/tag/v1.0.6)

DSBot Desktop is a local Windows control panel for a QQ AI chat stack. It brings DeepSeek Harness (DSH), SnowLuma (the OneBot v11 QQ gateway), and QQ Bridge service controls, status, bot settings, logs, and persona cards into one desktop app.

## Screenshots

![DSBot local service status page](assets/screenshots/service-status.png)

*Service states and ports shown here are demo data and do not represent live services.*

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/role-cards.png" alt="Persona cards assigned per QQ conversation" width="100%"></td>
    <td width="50%"><img src="assets/screenshots/role-editor.png" alt="Markdown persona editor" width="100%"></td>
  </tr>
  <tr>
    <td align="center">Choose a persona for a conversation. Switching archives its previous DSH session and opens a new one.</td>
    <td align="center">Edit persona instructions as Markdown.</td>
  </tr>
</table>

## How It Works

~~~text
QQ group / private chat ⇄ SnowLuma ⇄ QQ Bridge ⇄ DeepSeek Harness agent
                                      ⇅
                                restricted MCP tools

DSBot Desktop ── manages local service lifecycle, status, settings, logs, and persona cards
~~~

The desktop app manages local services. QQ Bridge routes QQ messages to their corresponding DSH sessions and returns agent replies or interaction results to QQ. SnowLuma is a separate component that users install and sign in to themselves.

## Features

### Desktop controls

- Periodically checks local service port responses for DSH, SnowLuma, and QQ Bridge, with controls to start missing services.
- Opens SnowLuma, bot settings, and runtime logs from the desktop app.
- The Windows installer includes Node.js, DSH, QQ Bridge, and their runtime dependencies.

### QQ sessions and persona cards

- Group chats and private chats map to separate DSH sessions.
- Persona choice is saved per QQ conversation. Switching personas archives the previous DSH session and creates a new one for that conversation.
- View and edit Markdown persona instructions in the desktop role-card page.
- Supports quoted replies, agent questions, and tool-approval round trips.

### Bridge capabilities

- Receives QQ events through OneBot v11 and sends messages to DSH agents.
- Provides restricted MCP tools for authorized group information and message history, plus configured sending, quoted replies, and interactions.
- Includes chat and simulated group-friend modes. Proactive speech, waiting, and silent behavior depend on the selected mode and DSH agent instructions.
- Includes supporting features for group topics, member impressions, slang, and stickers. Exact behavior depends on configuration, dependencies, and runtime mode.

## Install and First Run

1. Download and install the Windows installer from the [v1.0.6 Release](https://github.com/Satulalala/DSBot-Desktop/releases/tag/v1.0.6).
2. On first launch, select an existing SnowLuma installation directory. The installer does not bundle the SnowLuma service itself.
3. Sign in to QQ in SnowLuma and configure its OneBot v11 WebSocket and HTTP APIs.
4. Check service status in DSBot Desktop, then review bot access lists, runtime mode, and DSH model settings.
5. Open **DSBot → Switch Persona Cards…** to assign or edit a persona for a QQ conversation.

Keep the DSBot Desktop app-data directory for the current Windows user when upgrading. It stores desktop settings, Bridge configuration, session state, and persona cards. SnowLuma manages its own QQ login and runtime data.

## Build from Source

Use Windows x64 and Node.js 22.13 or later. Clone the repository, then build the desktop app:

~~~powershell
git clone https://github.com/Satulalala/DSBot-Desktop.git
cd DSBot-Desktop
cd desktop-app
npm install
npm run make
~~~

The runtime preparation script downloads and verifies the official Node.js distribution, then packages DSH, QQ Bridge production dependencies, and license files. SnowLuma must still be installed separately.

## Security and Limitations

- Before connecting a real QQ account, review allow/deny lists, the administrator QQ ID, runtime mode, and agent tool permissions.
- Configuration, QQ login data, session state, and logs are local data. Do not commit config.json, state, credentials, or runtime logs; the public repository contains example configuration only.
- The status page uses local port responses as a service check. A responding port does not verify the process version, configuration, or account login state. Check runtime logs when diagnosing an issue.
- Recognition of image and other attachments depends on OneBot event data, the Bridge processing path, and DSH model capabilities. Some paths pass attachments as placeholder text.
- SnowLuma itself and third-party dependencies retain their own licenses. Relevant license and dependency notices are included with the installer.

## Documentation

- [Bridge architecture, runtime modes, and configuration](docs/QQ-BRIDGE.md)
- [Project technical guide and data flow](docs/PROJECT_GUIDE.md)
- [DSH setup guide](docs/DSH_SETUP.md)
- [Desktop user guide](desktop-app/README.md)

## Repository Layout

~~~text
desktop-app/       Electron app, persona pages, and runtime packaging
src/               QQ Bridge, DSH client, safe MCP tools, and message handling
dsh/               DSH agent presets
roles/             Markdown persona cards
docs/              Architecture, configuration, and operations guides
assets/            Project screenshots
config.example.json Example config; never commit real configuration
~~~

## License and Disclaimer

The Bridge code is covered by the MIT License in the repository root. See component directories for desktop and third-party runtime notices. DSBot is not affiliated with SnowLuma, Tencent/QQ, or DeepSeek. Follow QQ platform rules and all applicable component licenses.
