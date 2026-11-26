# 0013 `@bluepax/cms-client` 与 `@bluepax/cms-blocks`：契约共用、客户端行为与发布形式

- 状态：已采纳（2026-11-26）
- 涉及：规范第 1 章（前台只依赖 SDK 与区块 JSON Schema）、第 6 章（SDK 与区块 Schema 包、约定、Webhook 接收端校验、
  前台接入清单）、第 10 章（npm 包、目录）、第 11 章（版本号、发布流程）、第 12 章（“`@bluepax/cms-client` 类型与文档
  同源生成”“`examples/minimal-site` 只依赖公开 SDK”），`packages/cms-client/`、`packages/cms-blocks/`、
  `packages/presets/src/routes.ts`、`apps/cms/src/lib/server/delivery/`

## 背景

第 6、10 章要求发布类型化 SDK `@bluepax/cms-client` 与区块 Schema 包 `@bluepax/cms-blocks`；第 12 章要求 SDK 类型与
OpenAPI 文档同源生成、最小示例前台只依赖公开 SDK。ADR 0012 把 Delivery 响应的 Zod schema 放在
`apps/cms/src/lib/server/delivery/contract.ts` 并由它生成 OpenAPI，把 `verifyPreviewToken` / `verifyWebhook` 与两个包的
发布留给本项。规范没有规定：契约放在哪里、客户端的接口形状、错误怎样表示、是否带缓存、包的构建形式，以及 M1 是否
需要这两个校验函数。

## 决策

### 契约放进 SDK

- 契约（带 `.meta({ id })` 的 Zod 响应 schema）移到 `packages/cms-client/src/contract.ts`，作为
  `@bluepax/cms-client/contract` 发布；CMS 反过来依赖 `@bluepax/cms-client`（`workspace:*`），OpenAPI 生成与契约测试
  照旧用这些 schema。一处定义、三处使用——OpenAPI 文档、CMS 的契约测试、SDK 类型（`z.infer`）——即第 12 章的
  “同源生成”。
- 没有选“从 OpenAPI 生成类型”：要多一个生成工具，还要多一份需要检查是否最新的生成文件；也没有另设契约包：公开包
  不能依赖私有包，而再多一个公开包没有必要。
- SDK 主入口只用 `import type` 引用契约，运行时不加载 Zod；`zod` 仍列在 `dependencies`，因为声明文件引用它的类型，
  `/contract` 子路径运行时也需要它。
- 端点表 `DELIVERY_ENDPOINTS`（按 OpenAPI 的 `operationId` 记路径与查询参数名）放在 SDK 中，CMS 的测试把它与 CMS 的
  操作表逐项比较：CMS 新增、改名或改参数的端点，SDK 没跟上时 CMS 的测试失败。

### 客户端

- `createCmsClient({ baseUrl, token, fetch?, timeout?, cache?, staleIfError?, onStale? })`。`baseUrl` 是 CMS 的公开地址，
  客户端补上 `/api/delivery/v1`。方法名与 `operationId` 相同：`getSite`、`resolveRoute`、`getPage`、`listPosts`（可按
  `category` / `tag` / `author` 过滤）、`getPost`、`listPostCategories`、`listTags`、`listAuthors`、`getAuthor`、
  `getBlockSchemas`、`getPreview`，以及不带 Token 的 `getOpenApi`。只传端点接受的查询参数，路径参数做 URL 编码。
- 用标准 `fetch`，也可注入；`withFetch(event.fetch)` 得到设置与缓存相同的客户端，供 SvelteKit 的 `event.fetch` 使用。
  默认超时 10 秒。
- **只在服务端**：检测到 `window` 与 `document` 时构造即报错，防止 Token 意外进入浏览器代码（第 6 章约定）；
  `dangerouslyAllowBrowser` 只留给定义了这两个全局变量的可信服务端运行时。
- **错误**：一律抛出 `CmsError`，带 `kind`（`bad_request` 400 / 405、`unauthorized` 401、`forbidden` 403、`not_found` 404、
  `gone` 410、`rate_limited` 429、`http` 其他 4xx、`server` 5xx、`network`、`timeout`、`invalid_response`）、HTTP `status`
  （没有响应时为 0）、接口的 `code` / `message` / `details`、`retryAfter`（秒；取 `Retry-After`，秒数或 HTTP 日期均可，
  缺省时取 `details.retryAfter`）与请求 `url`（不含 Token）。错误体不是接口格式时（例如网关的 HTML 页）保留 HTTP 状态，
  `code` 为 `http_<状态码>`。`isCmsError()` 也认得另一份包副本抛出的错误。调用方自己的 abort 原样抛出。
  `/routes/resolve` 的 301 / 404 是响应体里的结果，不是错误。
- **缓存（可选）**：传入 `cache`（`memoryCache({ maxEntries })`，或自备的、可异步的存储）后，按请求 URL 保存带 `ETag`
  的响应体，下次请求带 `If-None-Match`，304 时复用（每次返回新的对象）；`Cache-Control: no-store` 的响应与预览从不
  保存。打开 `staleIfError` 时，CMS 不可达、超时或返回 5xx，就返回同一请求缓存的内容并调用 `onStale`；4xx 照常抛出。
  这是前台接入清单第 7 步“CMS 不可达时用缓存渲染已缓存页面”的基础。

### 其他导出

- `verifyPreviewToken(secret, token)`：**M1 就提供**。只用 Web Crypto（Node.js、Deno、Bun、边缘运行时都可用），格式与
  ADR 0012 相同，签名用 `crypto.subtle.verify` 比较；CMS 的测试用 CMS 签发的 token 交叉验证。它是可选的预检：
  `GET /preview/{token}` 在 CMS 端仍会校验，持有预览密钥的前台可以先挡掉伪造或过期的链接，不必请求 CMS。
- `verifyWebhook()`：**延后到 M2**，与 Webhook 发送端一起做。规范定了头部、签名对象与时间窗，但签名的编码（hex 还是
  base64、有无前缀）与投递 ID 去重的存放要与发送端一起确定并互相测试；现在做只会有一边。
- `jsonLdScript()` / `serializeJsonLd()`：把 `seo.jsonLd` 写成可以直接放进 `<script type="application/ld+json">` 的文本，
  `<`、`>`、`&`、U+2028、U+2029 写成 `\uXXXX`，内容对 JSON-LD 解析器不变，但无法用 `</script>` 跳出元素。
- `routePath()`（`@bluepax/cms-client/routes`，没有其他依赖）：按路由模板生成地址。它原在 `@bluepax/presets/routes`，
  现在由 presets 转出，CMS 与前台用同一个实现。
- `knownBlock()`：按 `type` 把区块收窄为 `@bluepax/cms-blocks` 的数据类型；未知类型返回 null，前台忽略并记录
  （第 6 章）。

### `@bluepax/cms-blocks` 一并可发布

- 第 1、12 章：前台只依赖 cms-client 与区块 JSON Schema；示例前台渲染区块要用区块类型，所以本项一起把它改为可发布：
  去掉 `private`，加上 `repository`、`publishConfig.registry`、`files` 与 LICENSE。
- 新增不依赖 Zod 的子路径 `@bluepax/cms-blocks/keys`（`BLOCK_KEYS`、`isBlockKey`），cms-client 用它判断区块类型，
  不必加载全部 schema。
- 构建时除 JS 与声明文件外，还写出 JSON Schema 文件：`dist/schemas/index.json`（与 `GET /schema/blocks` 的形状相同，
  含全部 13 种区块）、`dist/schemas/rich-text.json`、`dist/schemas/blocks/<key>.json`，导出为
  `@bluepax/cms-blocks/schemas/*`——即 ADR 0012 所说“发布该包时输出同样的文件”。

### 包的形式

- ESM（`type: module`），`engines.node >= 22`。仓库内的 `exports` 仍指向 `src/*.ts`：CMS、测试与示例前台直接用源码，
  类型检查与测试不需要先构建；`publishConfig.exports` 指向 `dist/`（`types` + `default`），`pnpm pack` / `pnpm publish`
  时替换进打包的 `package.json`。
- 构建（`pnpm build`）：`tsc` 开启 `rewriteRelativeImportExtensions`，输出 JS 与 `.d.ts`，然后在纯 Node.js 下加载产物
  自检。cms-client 编译时用 `paths` 指向 cms-blocks 的 `dist` 声明，只输出自己的文件；`pnpm -r build` 按依赖顺序先
  构建 cms-blocks。声明文件里的相对导入保留 `.ts` 扩展名，TypeScript 可以解析（已在不开 `allowImportingTsExtensions`、
  不跳过库检查的独立项目中验证）。
- 版本号按第 11 章：仓库中保持 `0.0.0-development`，由 `release.yml`（`scripts/release/npm.ts set-version`）按标签写入；
  cms-client 对 cms-blocks 的 `workspace:*` 在打包时换成同一版本，两个包与 CMS 同步发版。
- 真正的发布沿用已有的 `release.yml`（打包并发布所有非 private 的 workspace 包），本项不改 workflow；首次发布后把包设为
  Public 见第 13 章开工清单。

## 影响

- `examples/minimal-site` 只依赖 cms-client（区块类型经它取自 cms-blocks），见 0014。
- 契约改在 `packages/cms-client` 中进行（提交范围 `cms-client`），一次改动同时改变 OpenAPI 文档与 SDK 类型；v1 只增
  字段、不删不改（第 6 章）。
- 以后：`verifyWebhook()`（M2，与 Webhook 一起）；Event API、`/feed`、`/seo/*`、`/search`、目录与区域端点上线时在
  SDK 中加方法（CMS 的测试会提醒）；首次发布时确认 GitHub Packages 的 dist-tag 与组织包权限（ADR 0001）。
