# 0011 路由模板：配置、校验、地址生成与路径解析

- 状态：已采纳（2026-11-26）
- 涉及：规范第 2 章（“前台”分组：路由模板、保留 slug，模板固定段自动保留）、第 3 章（`site` 模块与权限、slug 修改
  写 301）、第 6 章（“路由模板”、`GET /site`、`GET /routes/resolve`、前台接入清单第 2 步）、第 12 章（导出的配置
  在空库上得到相同的路由模板；改 slug、品类或路由模板生成 301）、第 13 章（M1 的“路由模板”与“Delivery / Preview
  API”，M2 的 `seo`），`packages/presets/src/routes.ts`、`packages/presets/src/config.ts`、
  `apps/cms/src/lib/server/content/routes.ts`、`apps/cms/src/lib/server/modules/site/settings.ts`、
  `apps/cms/src/routes/(app)/settings/frontend`

## 背景

规范给出了默认模板、四个占位符、“每种内容语言都带前缀”、地址小写且不带末尾斜杠、任意两类内容不得生成相同地址、
固定段自动加入保留 slug、改模板为受影响的已发布地址写 301 且先显示数量并确认，以及 `/routes/resolve` 返回内容
类型与 ID、各语言地址、301 目标或 410 标记。规范没有规定：模板在配置文件中的写法、各类内容可用哪些占位符、
“不会生成相同地址”怎样判定、首页自己的 slug 怎样解析、带大写或末尾斜杠的路径怎样解析、M1 没有 301 表时改模板
怎么办（301 表属于 M2 的 `seo`），以及 `/routes/resolve` 的 HTTP 端点在 Delivery Token、限速与 CORS 之前能否上线。
ADR 0009、0010 把路由模板的配置、`/routes/resolve`（含首页 slug 的地址）与按配置计算固定段留给本项。

## 决策

- **配置**：实例配置 `frontend.routes`，键为 `home`、`page`、`post`、`postCategory`、`tag`、`author`，各是一个模板
  字符串（去掉首尾空白）。省略的键取默认值，所以没有 `routes` 的旧配置文件仍然有效；未知键拒绝。企业与博客预设
  的默认值相同（第 6 章的表）。初始化时随 `frontend` 设置行写入，导出时写出全部六个模板，从导出初始化的新实例得到
  相同的模板。`examples/config/*.yaml` 写出了默认值。
- **目录模板**（`/{locale}/{type}` 等三项）随 catalog（M4）加入同一分组，`{type}`、`{category}` 已是已知占位符。
  默认的 `/{locale}/{type}` 与 `/{locale}/{slug}` 段数相同，只有目录类型 key 不与页面 slug 重名时才不同址，所以
  M4 要像固定段一样保留目录类型 key，查重时按此处理 `{type}`。
- **模板规则**（`routeTemplateIssues`，配置校验、后台保存与后台页面的实时提示共用同一函数）：
  - 形如 `/段/段`：以 `/` 开头，没有空段与末尾斜杠，最长 200 个字符、8 段。
  - 一段要么整段是占位符，要么是固定段；固定段须满足 `isSlug`（小写字母、数字与单个连字符）。不支持
    `post-{slug}` 这样占半段的占位符。
  - 第一段必须是 `{locale}`（“每种内容语言都带前缀”）。地址中的语言码一律小写（`zh-CN` → `zh-cn`）。
  - 首页只含 `{locale}`，可加固定段（如 `/{locale}/start`）；页面、文章、分类、标签、作者须各含一次 `{locale}` 与
    `{slug}`，不能有其他占位符。
  - 查重：两个模板段数相同、且每个位置都“可能相等”时视为可能生成相同地址，两个模板都报错，并给出冲突的模板与
    示例地址。固定段与固定段只在相同时相等；固定段与占位符一般可能相等，但页面与文章的 `{slug}` 除外——固定段是
    保留 slug，页面与文章的 slug 不会等于它。分类、标签、作者的 slug 不检查保留 slug（ADR 0010），它们的 `{slug}`
    可能等于固定段。这样只要下一条成立，库中任意两条内容都不会同址，解析不需要优先级。
  - 固定段自动保留（与 `frontend.reservedSlugs` 一起）。保存模板时，新模板的固定段若已被页面或文章用作 slug，
    拒绝（`slug_in_use`，列出这些页面与文章，与保存保留 slug 相同），须先改它们的 slug。
- **改模板与 301**：
  - 保存前计算受影响的已发布地址（`addressChanges`：改动的模板所覆盖的内容在每个有地址的语言的旧地址与新地址）。
    有受影响地址而未确认时返回 `confirm_required`（数量与前 20 条），管理员在页面上确认这个数量后再提交；期间数量
    变化则重新确认。
  - M1 不写 301：301 表 `redirects` 属于 M2 的 `seo`，与改 slug 的做法相同（ADR 0009、0010）。保存时写审计
    `site.routes_change`：改动的模板的前后值，以及全部受影响地址（内容类型、ID、语言、旧地址、新地址）；另有各设置
    共用的 `site.update`。M2 的 seo 项据审计中的 `pages.slug_change`、`posts.*slug_change` 与 `site.routes_change`
    补写 301 并折叠链条。在那之前旧地址解析为 404，确认提示中说明了这一点。
- **地址生成**：`@bluepax/presets/routes`（新子路径，不含 Zod，后台浏览器端也引用）提供 `routePath`、`contentPath`、
  `pagePath`、`absoluteUrl`、`matchRoute` 与 `routeFixedSegments`；服务端 `content/routes.ts` 提供 `contentAddresses`
  （一条内容的各语言地址）、`publishedAddresses`（全部已发布地址，供 sitemap 等）与 `addressChanges`。canonical、
  hreflang、sitemap、RSS、llms.txt、富文本内链与 Webhook 受影响路径以后都用这些函数。后台编辑页的地址预览（SEO
  面板、首页 slug 提示）也改为按模板生成，不再自行拼路径。
- **哪些内容有地址**：页面与文章在该语言已发布时；分类与标签没有状态，有该语言的翻译即可；作者还须开启“公开作者
  页”。首页是一个页面，使用首页模板。
- **路径解析** `resolvePath`（模板匹配加数据库查询）：
  - `/` → 301 到主语言首页的地址（按首页模板，不检查是否已发布）。
  - 逐个模板匹配：语言段须是内容语言，slug 须满足 `isSlug`，找到有地址的内容即返回 200：内容类型、所用模板
    （`home` 或类型本身）、ID、语言、地址，以及有地址的每种语言的地址（含所请求的语言，按配置中的语言顺序）。
  - 首页按页面模板访问它自己的 slug（如 `/en/start`）→ 301 到首页地址（`/en`）。
  - 含大写字母或末尾斜杠的路径：去掉末尾斜杠并转小写后若是内容，301 到该地址，否则 404。规范要求前台把带斜杠的
    请求 301 到不带斜杠的地址，CMS 给出同样的答案。
  - 未发布的语言（不回退到其他语言）、未知路径、固定段本身（如 `/en/blog`）、保留 slug、不是内容语言的前缀、超过
    1000 个字符的路径：404。410 标记来自 M2 的 301 表。
- **`/routes/resolve` 的 HTTP 端点随“Delivery / Preview API”项上线**：第 6 章要求 `/api/*` 由 Token、限速与 CORS
  白名单保护，这些是下一项的内容，先开一个不鉴权的端点不符合规范。本项交付并测试解析逻辑，下一项加鉴权、响应
  格式（camelCase，字段名到时定稿）与缓存。`GET /site` 下发模板与保留 slug 同样随该项。
- **后台**：“设置 → 前台”分两张卡：“路由模板”（前台基础 URL 只读显示；六个输入框，提示可用占位符、默认值与示例
  地址，输入时按同一规则提示问题；改动影响已发布地址时先显示数量与地址并要求确认）与原有的“保留 slug”（显示按当前
  模板计算的固定段）。表单动作 `?/routes` 与 `?/reserved`。权限沿用 `site.manage`：第 3 章 `site` 模块“编辑”为 ✗，
  规范没有为路由模板另设权限点，只有管理员能看到与修改，编辑访问页面与提交动作都得到 403。

## 延后

- 写 301、折叠链条、拒绝环路、删除记 410：M2 的 seo（据上述审计回放）。
- `GET /routes/resolve` 端点，`GET /site` 中的路由模板与保留 slug：Delivery / Preview API 项。
- sitemap、RSS、llms.txt 的数据，`seo` 对象中的 canonical 与 hreflang：M2 seo 与 Delivery API 项（用上面的函数）。
- 目录模板：catalog（M4）。
- 富文本与按钮链接到内容 ID：仍按 ADR 0009 延后。

## 影响

- 新增可路由内容时：在 `ROUTE_KINDS`、`ROUTE_KIND_RULES`、`DEFAULT_ROUTE_TEMPLATES` 与 `routeTemplatesSchema` 各加
  一项，在 `content/routes.ts` 的 `entriesOf` 加查询；其 slug 不检查保留 slug 时 `reservedSlugs` 设为 `false`。
- 检查保留 slug 一律用 `reservedSlugs(db)`，它按当前配置计算固定段。
- 保存模板与保存页面或文章的 slug 之间没有加锁（与保存保留 slug 相同），两者同时发生时可能让一个 slug 与新固定段
  重名；概率很低，需要时再用咨询锁串行化。
