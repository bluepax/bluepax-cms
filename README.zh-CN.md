# BluePax CMS

[English](README.md) | 简体中文

开源的通用 Headless CMS，面向企业官网与博客。只提供管理界面与接口，不渲染任何公开页面：
每个站点自行实现前台，通过带版本号的 Delivery API、Webhook、预览 Token 与区块 JSON Schema
与 CMS 对接。

> **状态：** 开发中，尚未发布。首个预览版为 `1.0.0-beta.1`。

## 特性

- 一个站点一个实例：独立的数据库、域名、存储与账号；不做多租户。
- 企业与博客两种预设，同一套代码；可选模块可逐项开关。
- 结构化内容 + 由 13 种标准区块拼装的页面。
- 多语言内容（BCP 47 语言代码，支持 RTL）；管理界面支持中文与英文。
- 默认本地存储，可选接入 Cloudflare R2 作镜像与分发。
- SvelteKit + Node.js + PostgreSQL，以容器形式通过 docker compose 部署，不使用 Redis。

## 快速开始

`docker compose` 一条命令启动实例的说明将随首个 beta 提供。

## 前台接入

前台从 GitHub Packages 安装类型化 SDK `@bluepax/cms-client` 与区块 Schema 包
`@bluepax/cms-blocks`，或按 OpenAPI 文档生成客户端。GitHub Packages 安装公开包也需要令牌：
本地用带 `read:packages` 权限的经典个人令牌（classic PAT），GitHub Actions 中用 `GITHUB_TOKEN`。

```ini
# .npmrc
@bluepax:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @bluepax/cms-client @bluepax/cms-blocks
```

详见[设计规范](docs/spec/README.md)第 6 章。

## 文档

- [设计规范](docs/spec/README.md)：唯一实现依据。
- [贡献指南](CONTRIBUTING.md)（英文）：开发环境、分支与提交规范。
- [安全策略](SECURITY.md)（英文）

## 许可

[MIT](LICENSE)
