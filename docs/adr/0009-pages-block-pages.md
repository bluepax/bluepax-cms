# 0009 pages 模块：区块页的存储、区块定义、状态、首页与保留 slug

- 状态：已采纳（2026-11-25）
- 涉及：规范第 2 章（“前台”分组的保留 slug、可用区块）、第 3 章（`pages`、管理界面、状态、SEO 面板、富文本）、
  第 4 章（标准区块、数据库与 `_translations` 规则、索引）、第 6 章（路由模板的“首页”“页面”、保留 slug、409、
  `GET /pages/{slug}`）、第 12 章（编辑账号、被引用的媒体）、第 13 章（M1 / M2 分界），`packages/cms-blocks`、
  `packages/core/src/slug.ts`、`packages/presets/src/routes.ts`、`packages/db/src/schema/pages.ts`、
  `apps/cms/src/lib/server/modules/pages`、`apps/cms/src/routes/(app)/pages`、
  `apps/cms/src/routes/(app)/settings/frontend`

## 背景

规范规定了 `pages` 模块的功能、13 种标准区块的字段、翻译表的列与约束、状态按语言管理、SEO 面板的内容、富文本
只允许的语义元素，以及 slug 不得与保留 slug 冲突。规范没有规定：区块怎么存、哪些字段跨语言共享、首页存在哪里、
状态之间怎样转换、发布与下线写哪个时间、富文本 JSON 的具体格式、区块 schema 放在哪里、保留 slug 在配置文件中的
格式、导航怎样链接页面，以及 M1 还没有工作副本时怎样不堵死 M2。

## 决策

- **数据表**（迁移集 `pages`）：
  - `pages`：所有语言共享的字段，目前只有“是否首页”与创建者。页面平铺，没有父子层级。
  - `pages_translations`（按第 4 章“主表 + `_translations`”命名）：`entity_id`、`locale`、`slug`、`title`、`status`、
    `published_at`、`unpublished_at`、`seo`（JSONB）、创建者与最后保存者。唯一约束 (entity_id, locale) 与
    (locale, slug)；列表索引 (locale, status, published_at DESC)；`status` 有检查约束。
  - `page_blocks`：每行一个区块（`translation_id`、`sort_order`、`type`、`data` JSONB），(translation_id, sort_order)
    唯一。
- **区块按语言分开存**：每个语言版本有自己的区块列表，跨语言共享的只有页面本身。状态按语言管理，发布一种语言不会
  连带改动其他已发布语言，各语言的版面也可以不同。新建语言版本时可以从已有语言复制区块作为起点（新 ID）。
  区块在存在期间 ID 不变（保存时保留已有 ID，新区块由服务端分配），供前台作渲染 key，也便于以后比较版本。
- **SEO 字段**存为 `seo` JSONB，由 `apps/cms/src/lib/server/content/seo.ts` 的 Zod schema 校验，文章、目录项等以后
  复用：meta 标题与描述、canonical（留空按路由模板生成）、robots（index / follow）、OG 标题、描述与图（媒体 ID）、
  目标关键词、一句话结论。OG 回退（OG 文字 → meta → 全局默认；OG 图 → 首图 → 全局默认）在 Delivery 输出时计算。
- **首页**：`pages.is_home`，部分唯一索引保证最多一个页面是首页；设为首页需要 `pages.publish`，原首页自动变回普通
  页面。首页不能删除（先指定另一个首页）。首页的各语言版本仍有 slug（满足 (locale, slug) 约束），地址按模板为
  `/{locale}`；`/{locale}/{首页 slug}` 301 到首页地址（ADR 0011）。
- **状态**（按语言）：草稿 → 待审核（提交审核）→ 已发布；待审核 → 草稿（退回）；已发布 → 已下线（下线）；草稿、
  待审核与已下线都可直接发布。发布写入 `published_at`（最近一次发布时间），下线写入 `unpublished_at`。保存与状态
  变化可在同一事务完成，编辑页的“发布”“提交审核”等按钮都会先保存表单。
- **权限点**：`pages.edit`（新建、编辑、提交审核、退回草稿、添加语言版本）、`pages.publish`（发布、下线、设为首页）、
  `pages.delete`（删除语言版本或整个页面），都是内容权限点，默认编辑角色全有。迁移集 `pages` 的第一个迁移给已有
  实例的 `editor` 角色补上；新实例按清单生成。媒体选择器的列表接口也允许 `pages.edit`。
- **M1 直接改内容，但不堵死 M2 的工作副本**：一个语言的可编辑内容是 `PageContent`（标题、slug、SEO、区块），由
  `writeContent` 一步写入翻译行与区块。M2 的 `drafts` 存同一结构（加上共享字段），发布时调用同一写入步骤，表结构
  不用改。编辑页提交打开时的 `updated_at`，期间有人保存过则返回 409（`edit_conflict`），不会覆盖别人的改动。
- **slug**：`isSlug`（`@bluepax/core`，用循环实现，不用会回溯的正则）要求小写拉丁字母与数字、组之间单个连字符、
  最长 100；同一语言内唯一，冲突返回 409（`slug_taken`，并发时由唯一约束兜底）；不得是保留 slug。
  - 保留 slug = 实例配置 `frontend.reservedSlugs`（本次新增，默认 `[]`，去重并排序，可在“设置 → 前台”修改）加上路由
    模板中的全部固定段。已被页面使用的 slug 不能设为保留，会列出这些页面。
  - 路由模板的配置属于后续的“路由模板”项；在那之前所有实例使用 `packages/presets` 的 `DEFAULT_ROUTE_TEMPLATES`，
    固定段为 `authors`、`blog`、`category`、`tag`。规范说“模板中的固定段自动加入保留 slug”，所以 `category`、`tag`
    也不能作页面 slug。（ADR 0011 起模板在配置 `frontend.routes` 中，固定段按当前模板计算。）
  - 改 slug 在 M1 不写 301；审计日志记 `pages.slug_change`（语言、旧 slug、新 slug、当时是否已发布），M2 的 seo 项
    可以据此为已上线的地址补 301。
- **区块定义只有一份**：13 种区块的 Zod schema 放在新包 `packages/cms-blocks`（`@bluepax/cms-blocks`，暂为 private），
  CMS 保存时用它校验，以后的“cms-client / cms-blocks 包”项用 `z.toJSONSchema` 从同一份 schema 生成并发布 JSON
  Schema。区块 key（`BLOCK_KEYS`）移到该包，`presets` 只按 key 引用；包的 `./links` 子路径只含链接检查，浏览器端
  引用它时不会带上 Zod。
  - 字段按第 4 章的表；未填的文本为空字符串，媒体为 ID 或 `null`；按钮必须同时有文字与链接；链接只允许前台路径、
    http(s)、`mailto:`、`tel:`。数字指标的数值存为文本（如 `24/7`）。
  - 区块 7、8、10 的 schema 先按规范的字段占位，随 catalog、regions 定稿（1.0.0 之前未发布，可以调整）。
  - 精选文章、最新文章先保存选取方式、数量、分类 ID 与文章 ID；选文章与分类的界面随 posts 提供。
- **可用区块**：实例配置 `blocks.available` 中、且由已启用模块的清单 `blocks` 提供的区块。`pages` 的清单提供不依赖
  可选模块的 10 种；7、8 将由 catalog、10 由 regions 的清单提供（M4），所以 M1 中它们不可用。区块内依赖可选模块的
  功能在 `BLOCK_FEATURES` 中声明（Hero 的选型条需要 catalog；联系 CTA 的表单与默认业务类型需要 inquiries）：模块
  关闭时界面不显示，接口只接受“关闭”值或该区块原有的值。已存但不再可用的区块原样保留，可以排序或删除，不能修改；
  不可用的区块类型不能新增。
- **富文本**：存 Tiptap（ProseMirror）文档 JSON，只允许 `doc`、`paragraph`、`heading`（2–4 级）、`bulletList`、
  `orderedList`、`listItem`、`blockquote`、`table` / `tableRow` / `tableCell` / `tableHeader`（可有 colspan、rowspan）、
  `image`（只存媒体 ID，地址、尺寸与各语言 alt 取自媒体）、`text`、`hardBreak`；标记只有 `link`（href）、`bold`
  （strong）、`italic`（em）。规范列出的是块级元素；strong 与 em 是语义元素而非内联样式，所以保留。
  - 保存前规范化：去掉编辑器附加的属性（class、列宽、target、rel 等）与默认值、空的 content、首尾的空段落。未知节点、
    未知标记和其他属性（如 style）会被拒绝。嵌套最深 12 层，JSON 最多 200 000 字符。
  - 目录项卡随 catalog 加入。编辑器为 Tiptap 3.35（MIT）；粘贴进来的外部图片不会变成图片节点，图片只能从媒体库选。
- **媒体引用**（ADR 0008）：保存前调用 `prepareMediaUse`（OG 图用途 `og`，生成 1200×630 JPG；Hero 背景接受图片或
  视频，其余字段只接受图片），在保存的事务里调用 `setMediaUsages`。
  - 引用以页面为目标、按语言替换：`UsageTarget` 新增可选的 `locale`，只替换该语言的引用。
  - 字段名为 `blocks.<区块 ID>.<路径>` 与 `seo.ogImage`；删除语言版本或页面时一并清除。
  - 媒体库的“引用位置”显示页面标题，并链接到对应语言的编辑页。
- **导航链接页面**（ADR 0007 延后项）：`nav_items` 新增 `page_id`（迁移集 `site` 的第二个迁移，外键
  `ON DELETE RESTRICT`）。菜单项链接页面或 URL 二选一，各语言的地址由 Delivery 按路由模板生成，所以改 slug 不用改
  导航。`site` 清单因此依赖 `pages`，迁移顺序为 core → media → pages → site。被菜单链接的页面不能删除，会列出这些
  菜单项。
- **SEO 面板**固定在编辑页右侧：slug、meta 标题与描述（按 60 / 160 字符提示建议长度）、搜索结果预览（标题与描述的
  回退同 Delivery 规则）、一句话结论、目标关键词、canonical、robots、OG。**Schema 预览简化**为本页 WebPage 的基本
  字段（name、description、url、inLanguage、keywords、publisher），完整 JSON-LD 随 Delivery API 生成。
- **审计**：`pages.create`、`pages.update`（只记字段名）、`pages.slug_change`、`pages.translation_create`、
  `pages.translation_delete`、`pages.status`、`pages.publish`、`pages.unpublish`、`pages.home`、`pages.delete`。
- **Webhook**：清单声明 `content.published`、`content.unpublished`、`content.deleted`、`content.slug_changed`，
  M2 实现 Webhook 后发送。

## 延后

- 工作副本、版本快照与回滚、定时发布：M2。
- 改 slug 自动写 301、永久删除记 410、`content.*` Webhook 的发送：M2（seo、Webhook）。
- Delivery `GET /pages/{slug}`、富文本的安全 HTML、`seo` 对象（回退、hreflang、含 publisher 的 JSON-LD）、媒体绝对
  URL：Delivery API 项。
- 路由模板的配置、`/routes/resolve`（含首页 slug 地址的处理）与按模板计算的固定段：路由模板项（已完成，见 ADR
  0011；`/routes/resolve` 的端点随 Delivery API 项）。
- 带签名的预览链接：Preview API 项。
- 精选文章、最新文章中选文章与分类的界面：posts。
- 区块 7、8、10 的编辑界面、Hero 选型条、联系 CTA 的表单与默认业务类型：catalog、regions、inquiries（M4）。
- 翻译表的全文检索列 `search_vector`：M2（搜索）。
- JSON Schema 的生成与 `@bluepax/cms-blocks` 的发布：cms-blocks 包项。
- 富文本与按钮内链指向页面 ID（目前只能填前台路径）：随路由模板与 Delivery API。

## 影响

- 以后的可路由内容（文章、目录项、品类、作者）沿用同样的结构：主表 + `_translations` 表（slug、标题、状态、发布
  时间、`seo`），复用 `seoSchema`、`checkSlug` 的规则与保留 slug；文章 slug 同样不得与保留 slug 冲突。
- 新增区块或区块字段时只改 `packages/cms-blocks`，v1 只增字段、不删不改（第 6 章）。
- 新增 `frontend` 配置项时同步更新 `frontendConfigSchema`、`examples/config/*.yaml` 与本记录。
