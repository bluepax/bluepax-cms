# BluePax 最小示例前台

[English](README.md)

[BluePax CMS](../../README.zh-CN.md) 的最小 SvelteKit 前台。它只依赖公开 SDK
[`@bluepax/cms-client`](../../packages/cms-client/README.zh-CN.md)，从 Delivery API 渲染首页、区块页、文章、分类、
标签、作者、404 页与预览。样式刻意保持最少：请把它当作起点，而不是主题。

- **只在服务端运行。** 页面在服务端渲染（`csr = false`）；Delivery Token 在 `src/lib/server/` 中从
  `$app/env/private` 读取，绝不会进入浏览器。服务端调用不需要 CORS。
- **一个通配路由。** 所有路径都交给 `GET /routes/resolve`：301 就重定向；404 渲染 404 页并返回 HTTP 404；200 按
  类型渲染页面、文章、分类、标签或作者。地址一律来自 CMS 的路由模板。
- **`<head>` 来自 `seo` 对象**：title、description、canonical、robots、Open Graph、hreflang 与 JSON-LD
  （`jsonLdScript` 转义了 `<`、`>`、`&`，数据无法闭合 `<script>` 元素）。
- **区块**：标准区块见 `src/lib/components/blocks/`；富文本使用接口返回的安全 HTML。`{@html}` 只用于接口的 `html`
  字段与 JSON-LD。不认识的区块类型被跳过并记录日志。区块 7、8、10 要等目录与区域端点（M4）。
- **预览**：`/preview?token=…`（编辑器的“预览”按钮），响应带 `Cache-Control: no-store` 与
  `X-Robots-Tag: noindex, nofollow`。
- **CMS 不可用时**：响应按 ETag 缓存；CMS 连不上时，已缓存的页面照常显示，其余请求返回 503 并带 `Retry-After`。

## 在本仓库中运行

1. 启动 CMS（见 [CONTRIBUTING.md](../../CONTRIBUTING.md)），例如 `http://localhost:5173`。
2. 在 CMS 中打开 **接入与 API**（仅管理员）：
   - 把 **前台基础 URL** 设为 `http://localhost:5180`，canonical、hreflang 与预览链接都会指向这里；
   - **签发 Token**：签发带 `delivery:read` 权限的 Delivery Token，它只显示一次；
   - 可选：**更换预览密钥** 并复制，`/preview` 就会先自行校验链接。
3. `cp examples/minimal-site/.env.example examples/minimal-site/.env`，填入 `BLUEPAX_CMS_URL`、
   `BLUEPAX_DELIVERY_TOKEN`，以及可选的 `BLUEPAX_PREVIEW_SECRET`。
4. 运行 `pnpm --filter @bluepax/minimal-site dev --port 5180`，打开 `http://localhost:5180`。

## 在本仓库之外使用

复制整个目录，把 `package.json` 中的 `"@bluepax/cms-client": "workspace:*"` 换成你运行的 CMS 版本号（两者同步发版）。
这些包发布在 GitHub Packages，安装公开包也需要令牌：本地用带 `read:packages` 权限的经典个人令牌（classic PAT），
GitHub Actions 中用该仓库自带的 `GITHUB_TOKEN`（需先在包设置中授予该仓库读取权限）。

```ini
# .npmrc
@bluepax:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
NODE_AUTH_TOKEN=<你的令牌> pnpm install
```

## 生产部署

```bash
pnpm build
ORIGIN=https://www.example.com BLUEPAX_CMS_URL=https://cms.example.com BLUEPAX_DELIVERY_TOKEN=… node build
```

`ORIGIN` 是本前台的公开地址（adapter-node 需要）。轮换 Token：在 CMS 中先签发新 Token，前台换用后再吊销旧的。

## 暂未包含

sitemap、robots、RSS 与 llms.txt（`/seo/*`，M2）、Webhook 接收端点（`verifyWebhook()`，M2）、经 Event API 上报 404
（M2）、询盘表单、目录、区域与追踪（M4）。
