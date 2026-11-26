# 0014 `examples/minimal-site`：只依赖 SDK 的最小 SvelteKit 前台

- 状态：已采纳（2026-11-26）
- 涉及：规范第 6 章（约定、路由模板、前台接入清单第 1–5、7 步）、第 10 章（目录）、第 12 章（“`examples/minimal-site`
  只依赖公开 SDK 即可渲染首页、文章页与 404”）、第 13 章（M1“最小示例前台”），`examples/minimal-site/`

## 背景

M1 的最后一项是最小示例前台，第 12 章的验收要求它只依赖公开 SDK 渲染首页、文章页与 404。规范第 6 章的接入清单说明
了前台要做的事，但没有规定示例前台的范围、环境变量、渲染方式，以及接口不可用、未知区块与预览时的具体表现。

## 决策

### 交付与依赖

- 分两个分支、按顺序交付：`feature/cms-client`（SDK 与可发布的 cms-blocks，见 0013）先合入，`feature/minimal-site`
  再合入；示例前台是 SDK 的第一个使用者，SDK 的接口问题在它身上暴露。
- 示例前台是 private 的 workspace 包 `@bluepax/minimal-site`，运行时只依赖 `@bluepax/cms-client`（`workspace:*`）。
  区块数据的类型经 SDK 的 `KnownBlock` 取自 `@bluepax/cms-blocks`（SDK 的依赖），示例不直接依赖它，也不引用 CMS 的任何
  内部包。复制到仓库外时把 `workspace:*` 换成 CMS 的版本号，并按 README 写 `.npmrc`。

### 渲染与密钥

- **只在服务端渲染**（根布局 `csr = false`）：页面不带任何客户端 JavaScript，Token 与 CMS 的响应只在服务端出现；
  Token 从 `$app/env/private` 读取，CMS 客户端放在 `src/lib/server/`（SvelteKit 不允许浏览器代码引用）。每个请求用
  `cms.withFetch(event.fetch)` 发出调用。
- 环境变量：`BLUEPAX_CMS_URL`（CMS 的公开地址）、`BLUEPAX_DELIVERY_TOKEN`（`delivery:read`）、可选的
  `BLUEPAX_PREVIEW_SECRET`（预览密钥）；生产环境另设 adapter-node 的 `ORIGIN`。构建时都可缺省，第一次请求时检查。
- 安全头：`Content-Security-Policy` 不允许任何脚本（JSON-LD 是数据块，不受影响），图片与视频只允许本站、CMS 与
  `/site` 给出的媒体分发源；另有 `X-Content-Type-Options` 与 `Referrer-Policy`。

### 路由

- 只有一个通配路由 `[...path]` 与 `/preview`。每个请求先 `GET /routes/resolve`：`status` 301 就 301 到 `location`
  （只跟随本站路径，保留查询串）；404 返回 HTTP 404 并渲染 404 页（M2 的 410 同样处理）；200 按 `type` 调
  `/pages/{slug}`、`/posts/{slug}`、分类或标签（`slug` 过滤取 `seo`，再按分类或标签列文章）、`/authors/{slug}`。
  尾部斜杠、大写与 `/` 都交给 CMS 的 301（`trailingSlash = 'ignore'`），前台不自行判断。列表页用 `?page=`，非正整数
  或超过 10 000 时 404。
- 站点设置按路径第一段的语言取（路由模板要求 `{locale}` 在最前）；不是内容语言时 CMS 返回 `invalid_locale`，改取主语言。
  `<html lang dir>` 取自内容的语言与 `/site` 中该语言的书写方向；布局与页面的 load 并行执行，所以分开记录，页面（预览）
  的值优先。

### 页面内容

- `<head>` 原样输出 `seo` 对象：title、description、canonical、robots、keywords、hreflang、Open Graph（含图片宽高与
  alt）、Twitter 卡片，以及 JSON-LD。JSON-LD 用 SDK 的 `jsonLdScript()` 输出，这是 `{@html}` 唯一用于接口 `html` 字段
  以外的地方，序列化时 `<`、`>`、`&` 已转义；其余 `{@html}` 只用于区块的 `html` 字段与文章的 `bodyHtml`。
- 语言切换只列出当前内容已发布的语言版本（`alternates`）；没有某语言版本时不链接到其他页面，错误页不显示切换器
  （第 6 章：不回退到其他语言）。
- 区块：当前实例提供的 10 种标准区块都有组件；7 目录入口、8 目录列表、10 服务网络要等 M4 的目录与区域端点，先保留
  位置、不显示内容。不认识的区块类型被跳过，并在服务端日志中记录。链接再按 CMS 的规则检查一次（路径、http(s)、
  `mailto:`、`tel:`），媒体用接口给的绝对地址与 WebP 衍生图的 `srcset`。
- 前台自身的少量界面文字只有中文与英文（`zh*` 用中文，其他语言用英文）；内容与导航全部来自 CMS。

### 预览

- `/preview?token=…`：设置了预览密钥时先用 `verifyPreviewToken()` 校验（伪造或过期直接 403），再调
  `GET /preview/{token}`；CMS 返回 `preview_invalid` / `preview_expired` 时同样 403。页面顶部显示“预览”、内容状态与
  链接到期时间（站点时区）。`hooks.server.ts` 对 `/preview` 的所有响应（包括错误页）设置 `Cache-Control: no-store` 与
  `X-Robots-Tag: noindex, nofollow`；`seo.robots` 本身也是 `noindex, nofollow`。

### CMS 不可用

- SDK 客户端带 `memoryCache({ maxEntries: 1000 })` 与 `staleIfError`：响应按 ETag 复用；CMS 连不上、超时或返回 5xx 时，
  已缓存的请求照常渲染并记录日志，其余请求返回 503 并带 `Retry-After`（取 CMS 给的值，否则 30 秒），对应接入清单
  第 7 步。缓存只在单个进程内，重启后清空。

## 影响

- 第 12 章“`examples/minimal-site` 只依赖公开 SDK 即可渲染首页、文章页与 404”可以验收；M1 的功能项全部完成。
- 以后：sitemap、robots、RSS、llms.txt（`/seo/*`）、Webhook 接收端点（`verifyWebhook()`）、经 Event API 上报 404
  （M2）；询盘表单、目录、区域与追踪（M4）随各自端点加入示例。
