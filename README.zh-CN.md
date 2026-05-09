# Phodex Web（中文说明）

[English README](README.md)

Phodex Web 是一个 Bun monorepo，用于在 Web 端复现 Remodex 风格的 Codex 移动端体验与行为。它提供公网 Web Relay、邮箱 OTP 登录，以及连接本地真实 Codex app-server 的出站 Bridge。

本项目采用“以源码行为为准”的重建方式，目前仍在持续完善中。当前代码适合开发、实验和自托管使用，但还不是最终完成形态。

## 当前已实现

- 基于 Relay 的邮箱 OTP 登录。
- 面向 Web 客户端的公网 HTTP 与 WebSocket Relay。
- 面向 Codex app-server 的本地出站 Bridge 集成。
- 聊天创建、线程列表、消息发送、流式回复、停止、重命名、归档、排队草稿与草稿恢复。
- 按需加载的项目浏览与选中线程历史加载。

## 当前限制

- 视觉与交互一致性仍未完全对齐。
- 购买与恢复流程目前仅为预览态。
- 更丰富的 turn 展示与结构化输入替代能力仍是部分完成。
- 二维码登录、摄像头配对、端到端加密为明确排除范围。

## 仓库结构

```text
apps/web        Vue 3 + Vite 移动 Web 客户端
apps/server     Bun Relay 与本地 Codex Bridge 运行时
packages/shared 共享协议与记录类型
docs/ai         项目上下文、架构说明与验证指南
```

## 运行要求

- Bun `1.3.13` 或兼容版本。
- 本地 Bridge 模式下需要运行中的 Codex app-server。
- 运行公网 Relay 时需要可用的 OTP 邮件发送凭据。

## 快速开始

安装依赖：

```sh
bun install
```

启动 Web 客户端：

```sh
bun run dev:web
```

启动公网 Relay：

```sh
bun run dev:relay
```

启动本地 Bridge：

```sh
bun run dev:bridge
```

构建 Web 客户端：

```sh
bun run build:web
```

## 配置说明

Relay 会从环境变量读取 OTP 邮件配置：

```sh
PHODEX_RESEND_API_KEY=...
PHODEX_AUTH_EMAIL_FROM=...
```

服务端也支持较短的兼容变量名：`RESEND_API_KEY` 和 `AUTH_EMAIL_FROM`。请使用环境变量或未纳入版本控制的本地密钥文件管理敏感信息，不要提交 API Key、会话令牌、Bridge 令牌或生产凭据。

可参考 [.env.example](.env.example) 作为本地 Relay/Bridge 配置模板。该文件中的值仅为示例，敏感值请保持为空并通过你自己的环境注入。

## 开发说明

- 以当前代码和真实运行行为为准。
- 保持本地 Bridge 为出站连接；公网 Relay 不应直接执行本地文件系统操作。
- 不要引入 OTP 后门、静态测试码或虚假生产数据。
- 修改时遵循 `docs/ai` 中记录的产品约束。

## 致谢

本项目在实现过程中参考并受益于上游开源项目和生态，尤其是：

- [Remodex](https://github.com/Emanuele-web04/remodex)（本项目在行为与 UI 重建上的主要上游参考）
- Codex 及相关 app-server 工作流
- Bun、Vue、Vite、Resend

感谢上游维护者和贡献者公开的项目与文档。

## 许可证

MIT。见 [LICENSE](LICENSE)。

## 声明

项目状态、商标/关联关系与安全声明见 [NOTICE.md](NOTICE.md)。
