# 0012 Delivery / Preview API：端点范围、Token、限速与 CORS、`seo` 对象、OpenAPI 与预览

- 状态：已采纳（2026-11-26）
- 涉及：规范第 1 章（与前台的边界、OpenAPI 标题）、第 2 章（“发布者”）、第 3 章（`api` 模块、权限、状态与预览、
  SEO 面板的回退、富文本）、第 5 章（媒体 URL、OG 图）、第 6 章（接口表、约定、路由模板、Delivery 端点、前台接入清单）、
  第 9 章（Token 只存哈希、审计、安全头）、第 12 章（编辑无法访问 Token；OpenAPI 与响应一致；统一错误体；OG 回退）、
  第 13 章（M1 的“Delivery / Preview API”、M2 的 `seo` 与 Webhook、默认值“限速”“预览链接”），
  `packages/db/src/schema/api.ts`、`apps/cms/src/lib/server/modules/api/`、`apps/cms/src/lib/server/delivery/`、
  `apps/cms/src/routes/api/delivery/v1/[...path]`、`apps/cms/src/routes/(app)/integration`、
  `packages/cms-blocks/src/json-schema.ts`

## 背景

第 6 章列出四类接口（Delivery、Event、Preview、Management）与全部 Delivery 端点，规定了 JSON 与 camelCase、按 `locale`
返回单语版本、分页、统一错误体、`ETag` / `Last-Modified`、默认限速、CORS 白名单、只允许服务端调用，以及“接入与 API”
页面签发的 Token 与密钥。规范没有规定：M1 先上线哪些端点、Token 的格式与轮换、没有 Redis 时怎样限速、CORS 白名单
的内容、各响应的字段、`seo` 对象的具体回退与 JSON-LD、安全 HTML 怎样生成、OpenAPI 文档与调试界面怎样做、
媒体绝对 URL 的 CMS 地址从哪里来，以及没有工作副本（M2）时预览的“草稿内容”指什么。ADR 0007、0009、0010、0011
把 `GET /site`、`/pages/{slug}`、文章端点、`/routes/resolve`、`seo` 对象与签名预览链接留给本项。

## 决策

### 端点范围

- **M1 上线**：`GET /site`、`/routes/resolve`、`/pages/{slug}`、`/posts`、`/posts/{slug}`、`/post-categories`、`/tags`、
  `/authors`、`/authors/{slug}`、`/schema/blocks`、`/preview/{token}`，以及无需 Token 的 `/openapi.json`。
- **不上线，访问返回 404**（与关闭的可选模块相同）：
  - `/feed`：与 sitemap、robots、llms.txt、301 表同在第 6 章 `/seo/*` 一行，“RSS 的数据”随 M2 `seo` 一起做；在此之前
    前台可用 `/posts` 生成 RSS。
  - Event API `POST /events`：它记录的 404 日志属于 M2 `seo`，AI 爬虫统计属于 1.1 `insights`，M1 没有存放之处。
    `events:write` 范围现在就随 Token 签发，端点上线后旧 Token 不用重发。
  - Management API `/api/manage/v1/*` 与 Management Token：首批端点（系统状态需要 worker 心跳与备份，源站检查属于 M3）
    都不在 M1；随 M2 的系统状态一起做。
  - `/search`（M2）、`/seo/*`（M2）、目录与区域（M4）。
- 端点由一张操作表（`delivery/operations.ts`）登记，同一张表驱动路由、OpenAPI 文档与后台调试台；每个端点标明所属
  模块，模块关闭时返回 404。各模块清单的 `endpoints` 也登记了自己的端点。

### Token、前台与密钥

- 新模块 `api`（核心，迁移集 `api`，依赖 media、pages、posts、site），权限点 `api.manage`（设置类，只有管理员）。
  “接入与 API”页面 `/integration` 放在“设置”之后；编辑打开页面或提交表单一律 403（第 12 章）。
- 表 `frontends`（一行，`key = default`）存预览密钥；`api_tokens` 存 Token。Webhook 地址与密钥（M2）、表单 Key（M4）
  随各自功能加列，页面上先说明。
- **Delivery Token**：`bpxd_` + 32 字节随机数（base64url），只存 SHA-256，按哈希查找；只在签发的那次响应里显示，列表
  显示前 11 个字符。范围 `delivery:read`、`events:write`，默认两者都选，至少选一个。可设 30 / 90 / 365 天过期或永不
  过期；最多 10 个有效 Token。**轮换** = 签发新 Token、前台换用、吊销旧 Token，两者在此期间都有效。吊销立即生效、
  不可恢复。`last_used_at` 每个 Token 每分钟最多写一次。签发与吊销写审计 `api.token_issue` / `api.token_revoke`
  （记录名称、前缀、范围、过期时间，从不记录 Token 本身）。
- **预览密钥**：`bpxp_` + 32 字节随机数，用 ENCRYPTION_KEY 加密存库（CMS 要用它签名，所以不能只存哈希）；只在生成或
  更换的那次显示，更换后旧的预览链接全部失效。审计 `api.preview_secret_rotate`。
- **前台基础 URL** 仍是配置项 `frontend.baseUrl`，改在“接入与 API”编辑（规范接入清单第 1 步），审计
  `api.frontend_update`（记录新旧值）。
- **配置文件与导出**：基础 URL 与路由模板是配置；Token、预览密钥（以及以后的 Webhook 密钥、表单 Key）是密钥，从不进
  配置文件与导出，在新实例上重新签发。

### 请求处理

- **鉴权**：`Authorization: Bearer <Delivery Token>`。缺失 401 `unauthorized`；未知、吊销或过期 401 `invalid_token`；
  缺少 `delivery:read` 403 `insufficient_scope`。会话钩子跳过 `/api/delivery|inquiry|manage/` 路径，这些响应从不带
  Set-Cookie。
- **限速（无 Redis）**：web 角色是单进程（第 9 章），沿用登录限速的进程内滑动窗口：每个 Token 每分钟 1200 次
  （第 13 章默认值），超出 429 `rate_limited` 并带 `Retry-After`；正常响应带 `X-RateLimit-Limit` /
  `X-RateLimit-Remaining`。另外每个客户端地址每分钟最多 60 次无效 Token，防止猜测时反复查库。重启后计数清零，
  多个 web 进程时各自计数——规范要求单实例部署，这样足够；需要跨进程时再改用 PostgreSQL 计数。限速值暂为常量，
  “可在实例配置中修改”（第 13 章）随以后的 `api` 配置分组提供。
- **CORS 白名单**：前台基础 URL 的 origin 与 CMS 自身的 origin。带其他 `Origin` 的请求 403 `origin_not_allowed`；
  白名单内的来源得到 `Access-Control-Allow-Origin` 并可预检（GET、HEAD、OPTIONS；Authorization、Content-Type、
  If-None-Match）。服务端调用不带 `Origin`，不受影响。白名单的作用是挡住其他网站的浏览器调用；Token 仍只该在服务端
  使用。
- **错误体**：`{ error: { code, message, details? } }`；400 `invalid_query` / `invalid_locale`（`details.languages`
  列出内容语言），404 `not_found`，405 `method_not_allowed`（带 `Allow`），500 `internal_error`。
- **缓存**：内容响应带强 `ETag`（响应体 SHA-256）与 `Cache-Control: private, no-cache`，`If-None-Match` 命中返回 304；
  能直接得到时间的响应带 `Last-Modified`（页面、文章的更新时间，列表取各项最大值，`/site` 取设置的最大更新时间）。
  `Last-Modified` 只作参考：区块里引用的文章或媒体变化时它不一定变，所以不处理 `If-Modified-Since`，以 `ETag` 为准。
  预览响应 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`。
- **分页**：`page`（1–10000）/ `pageSize`（默认 20，1–100），返回 `{ items, page, pageSize, total }`；分类、标签、作者
  列表同样分页，并可用 `slug` 参数只取一项（这些内容没有单独的详情端点，前台用它取分类页的 `seo`）。
- **语言**：`locale` 不分大小写（`zh-cn` 即 `zh-CN`），省略时取主语言，不是内容语言时 400。只返回该语言的文字，
  未填写的字段为空字符串或 null，从不回退到其他语言。分类、标签与作者在某语言有翻译才算存在（ADR 0010），文章里
  没有该语言翻译的分类、标签、作者引用被省略；没有公开作者页的作者 `path` 为 null。
- **媒体的绝对 URL**：本地分发源的 URL 以 CMS 的公开 origin 开头，取 SvelteKit 看到的请求 origin（`event.url.origin`）。
  adapter-node 从环境变量 `ORIGIN` 取它，生产部署必须把 `ORIGIN` 设为 CMS 的公开地址（表单提交的 CSRF 检查本来就需要），
  否则前台经内网地址调用时会得到内网 URL。`GET /site` 的 `mediaOrigin` 为 `{ driver, baseUrl }`。媒体对象返回 URL、
  宽高、大小、各语言 alt（第 6 章“各语言 alt”，所以 alt 是按语言的映射）与衍生图。

### 响应内容

- **`GET /site`**：类型、名称、`locale`、时区、语言、发布者、法律主体与地点（登记号与税号只在“公开”时返回，否则 null）、
  联系方式、社媒、即时通讯（该语言的预填文案）、导航（树形；指向页面、文章、分类的菜单项带该语言地址，没有地址时
  `href` 为 null 并保留 `target`）、页脚文字、品牌（标志、网站图标及其衍生图、theme-color）、已启用模块、前台基础 URL、
  路由模板、配置的保留 slug（模板固定段可从模板得出，不重复列出）、`mediaOrigin`。目录类型、业务类型、询盘表单
  schema、追踪设置随各自模块加入。
- **发布者**（第 2 章“发布者”，`resolvePublisher`，`/site` 与所有 JSON-LD 共用）：Organization 取配置名称或站点名称、
  自己的标志否则站点标志、配置的 sameAs，`url` 为前台基础 URL；Person 且有主作者时取主作者在该语言的显示名（没有该
  语言翻译时取配置名称或站点名称）、主作者头像与 sameAs，`url` 为其作者页（不公开或无翻译时为前台基础 URL）；Person
  无主作者时取配置名称或站点名称、配置的 sameAs 与后台设置的头像。JSON-LD 中 Organization 的图写作 `logo`
  （ImageObject），Person 写作 `image`。
- **区块页**：`blocks` 的每项是 `{ id, type, data, html, posts? }`。`data` 与区块 JSON Schema 完全一致（存储形式，
  补全默认值）；CMS 推导的内容放在旁边：`html` 是 `data` 中富文本字段的安全 HTML（按字段名），精选文章与最新文章区块的
  `posts` 是该语言已发布的文章摘要。区块与富文本引用的媒体按 ID 集中在页面的 `media` 中返回一次。当前实例不再提供的
  区块被省略，关闭模块的区块功能取其“关闭”值（第 3 章）；与 schema 不符的旧数据被省略并记录日志。
- **文章**：摘要含封面（内嵌媒体对象）、分类（第一个为主分类）、标签、作者；详情另有正文 JSON 与 `bodyHtml`、
  Key takeaways、正文媒体 `media` 与 `seo`。列表按发布时间倒序，可按分类、标签、作者的 slug 过滤（未知 slug 得空列表）。
- **`/routes/resolve`**：查询本身成功时总是 200，结果在 `status` 字段：`{ status: 200, type, route, id, locale, slug,
path, alternates }`、`{ status: 301, location }` 或 `{ status: 404 }`（M2 增加 `{ status: 410 }`）。HTTP 层不返回
  301（客户端会自动跟随），也不用 HTTP 404 表示“这个前台地址没有内容”，前台按 `status` 原样回应访客。`slug` 是本项
  新增的字段，前台用它调用 `/pages/{slug}` 等端点。缺少 `path` 参数时 400。
- **`/schema/blocks`**：`{ richText, blocks }`，由 Zod 4 自带的 `z.toJSONSchema` 从 `@bluepax/cms-blocks` 的 schema 生成
  （输出形式，JSON Schema 2020-12），只列当前实例提供的区块。生成函数 `blockJsonSchemas` 放在 cms-blocks 包中，发布
  该包时输出同样的文件。

### `seo` 对象

- 字段：`title`（meta title → 标题或名称）、`description`（meta description → 文章摘要 / 页面一句话结论 / 分类与标签
  说明 / 作者简介）、`canonical`（面板填写的值，否则按路由模板生成的绝对地址）、`robots`（如 `index, follow`）、`og`
  （type 为 website / article / profile，title：OG 标题 → meta 标题 → 标题；description：OG 描述 → description；url 为
  canonical；siteName；locale 如 `zh_CN`；image）、`hreflang`（只列已发布语言，`x-default` 指向主语言版本，主语言未发布
  时不出现）、`keywords`、`summary`、`jsonLd`。
- **OG 图回退**（第 3 章）：页面为 OG 图 → 区块中第一张图片；文章为 OG 图 → 封面 → 正文第一张图片；作者为 OG 图 → 头像；
  分类与标签只用 OG 图。全局默认 OG 文字与默认分享图属于 M2 的 `seo` 模块，在此之前回退到内容本身为止。按第 5 章，返回的
  一律是衍生的 1200×630 JPG：为此文章封面的媒体引用改用用途 `og`，页面没有 OG 图时第一张图片的引用也改用用途 `og`，
  保存时即生成这张图；还没有这张图的旧数据（以及正文中的图片）先返回原图，再次保存后补齐。
- **JSON-LD**：页面 `WebPage`（`isPartOf` 为该语言首页的 `WebSite`、`primaryImageOfPage`、发布与修改时间），文章
  `BlogPosting`（headline、description、image、datePublished、dateModified、author、mainEntityOfPage、keywords、
  articleSection），分类与标签 `CollectionPage`，作者 `ProfilePage`（`mainEntity` 为 Person）；都带 `@context`、`url`、
  `inLanguage`，除作者页外都带发布者。

### 安全 HTML

- 不引入依赖：`delivery/html.ts` 从富文本 JSON 逐个节点写出 HTML，只产生第 3 章允许的元素（h2–h4、p、ul/ol/li、
  blockquote、table/tr/th/td、img、a、strong、em、br）。所有文字与属性转义；链接只保留编辑器接受的目标（`isLinkUrl`），
  否则只留文字；图片来自媒体库（绝对 URL、该语言 alt、宽高、WebP 衍生图的 `srcset`、懒加载）；未知节点（如以后的目录项
  卡片）省略。因为没有解析 HTML 这一步，也就不需要事后净化。

### OpenAPI 与调试界面

- `GET /api/delivery/v1/openapi.json`（OpenAPI 3.1，标题“BluePax CMS”，第 1 章）由操作表与 `delivery/contract.ts`
  中的 Zod 响应 schema 生成（`z.toJSONSchema` + `.meta({ id })` 生成 `components.schemas`），不需要 Token：它描述的是
  接口而不是实例内容。集成测试用同一组 Zod schema 解析真实响应，文档与行为不会脱节（第 12 章契约测试）。contract 只依赖
  Zod，`@bluepax/cms-client` 可以直接接过这些类型（已移到 `@bluepax/cms-client/contract`，见 0013）。
- **调试界面**：没有引入 Swagger UI、Scalar 等库（体积大，还要放宽管理界面的 CSP）。“接入与 API”页面自带一个调试台：
  按操作表列出端点与参数，管理员粘贴一个 Token 后从页面直接调用真实接口（同源，走完整的鉴权、限速与 CORS），显示状态、
  主要响应头与 JSON。Token 只在页面内存中，不保存。

### 预览

- **“草稿内容”在 M1 的含义**：页面与文章还没有工作副本（M2），预览返回某个语言版本的当前内容，不论状态（草稿、待审核、
  已发布、已下线）；响应带 `status`。M2 有了工作副本后改为预览工作副本，接口形状不变。
- **链接**：编辑器（页面与文章）的“预览”按钮向 `POST /preview-link` 请求链接，能编辑该内容的人（`pages.edit` /
  `posts.edit`）都可以；链接为 `{前台基础 URL}/preview?token=<token>`，1 小时有效（第 13 章），预览的是已保存的内容。
  `/preview` 不会与内容地址冲突：路由模板要求 `{locale}` 是第一段。
- **Token 格式**：`<payload>.<signature>`，payload 是 base64url 的 JSON `{ v: 1, type: page|post, id, locale, exp }`，
  signature 是对 payload 字符串用预览密钥做的 HMAC-SHA256（base64url）。前台可用同一密钥先行校验（例如在设置预览
  cookie 前），cms-client 将提供校验函数。
- **接口**：`GET /preview/{token}` 除预览 token 外**也要求 Delivery Token**（`delivery:read`）：预览链接会经过浏览器，
  单凭它不应能从外部直接读取草稿。签名无效 403 `preview_invalid`，过期 403 `preview_expired`，尚未生成预览密钥 404
  `preview_unavailable`，内容已删除 404。响应为 `{ type, status, expiresAt, page | post }`，内容与 Delivery 响应同形，
  `seo.robots` 固定为 `noindex, nofollow`，`hreflang` 额外包含被预览的语言。

## 影响

- 前台可以按第 6 章接入清单完成第 1–4 步与预览路由；`examples/minimal-site` 可以开始做。
- 部署文档与 Dockerfile 项需要写明 `ORIGIN`（CMS 的公开地址）。
- 以后：`/feed`、`/seo/*` 与 404 上报（M2 `seo`，Event API）；Webhook 地址与密钥（M2）；Management API 与 Token（M2
  起）；表单 Key 与 Inquiry API（M4）；全局默认 OG 与分享图（M2 `seo`）；限速值进入实例配置；预览改为工作副本（M2）；
  `@bluepax/cms-client`（含预览 token 与 Webhook 校验函数）与 `@bluepax/cms-blocks` 的发布（单独一项）。
