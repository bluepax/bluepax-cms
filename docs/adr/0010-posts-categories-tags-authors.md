# 0010 posts 模块：文章、分类、标签与作者

- 状态：已采纳（2026-11-25）
- 涉及：规范第 2 章（博客预设、Person 发布者与主作者、“文章：预置分类”、通用种子）、第 3 章（`posts`、管理界面、
  状态、SEO 面板、富文本）、第 4 章（结构化实体“文章”“作者”、数据库与 `_translations` 规则、索引）、第 6 章（路由
  模板中文章、分类 / 标签、作者，Delivery 端点）、第 7 章（AI 草稿）、第 12 章（编辑账号、被引用的媒体）、第 13 章
  （M1 / M2 分界），`packages/db/src/schema/posts.ts`、`packages/presets/src/config.ts`、
  `apps/cms/src/lib/server/modules/posts`、`apps/cms/src/routes/(app)/posts`

## 背景

规范列出了文章与作者的字段、翻译表的列与约束、状态按语言管理、SEO 面板、博客的 Person 发布者为主作者、配置项
“文章：预置分类”与博客种子“一个默认文章分类”。规范没有规定：哪些文章字段跨语言共享、分类与标签有没有状态和层级、
多作者与多分类的顺序、作者与后台账号的关系、Key takeaways 与“发布与更新时间”怎样存、“预置分类”在配置文件中的
格式与导出方式、主作者存在哪里，以及文章、分类被页面区块和导航引用时怎样处理。ADR 0009 规定 posts 复用 pages 的
`_translations` 结构、`seoSchema` 与 slug 规则。

## 决策

- **数据表**（迁移集 `posts`）：`posts`、`post_categories`、`tags`、`authors` 各一张主表与一张 `_translations` 表
  （`posts_translations`、`post_categories_translations`、`tags_translations`、`authors_translations`），都有唯一约束
  (entity_id, locale) 与 (locale, slug)；关联表 `post_category_links`、`post_tag_links`、`post_author_links`（主键
  (post_id, 对方 ID)，带 `sort_order`，按对方 ID 建索引）。列表索引 (locale, status, published_at DESC) 只在有状态的
  `posts_translations` 上。迁移集的第一个迁移给已有实例的 `editor` 角色补上五个权限点。迁移顺序为
  core → media → pages → posts → site。
- **文章的共享字段与语言字段**：
  - 封面、分类、标签、作者所有语言共用（`posts.cover`、三张关联表），因为它们描述的是同一篇文章；各语言的 alt 取自
    媒体。
  - 标题、slug、摘要、正文、Key takeaways、SEO、状态、来源与各种时间按语言存。
  - `posts.updated_at` 只在共享字段变化时更新，用作共享字段的版本；编辑页只在共享字段被改过时才提交它们，
    改过且有人先改了共享字段时返回 409（`edit_conflict`），所以保存某一语言不会覆盖别人在另一语言改的共享字段。
    语言字段照 pages 用翻译行的 `updated_at` 判断冲突。
  - M1 直接改内容：`PostContent`（语言字段）与 `PostShared`（共享字段）分别由 `writeContent`、`writeShared` 写入，
    M2 的工作副本存同样的结构、发布时调用同样的步骤。
- **正文**沿用 pages 的富文本：Tiptap JSON，由 `@bluepax/cms-blocks` 的 `richTextSchema` 校验与规范化，编辑器与页面
  共用。**Key takeaways** 存为字符串数组（JSONB），每条一句、最多 10 条、每条 ≤ 300 字符，空行去掉；它是按语言的
  文本，不需要单独的表。**摘要**为纯文本，≤ 1000 字符。
- **多分类与多作者**：一篇文章最多 10 个分类、50 个标签、10 位作者。分类与作者按编辑器中的顺序存：第一个分类是
  主分类（供面包屑等），作者按署名顺序。分类与作者都可以为空；Delivery 在没有作者时用发布者。新文章默认署名
  与创建者账号关联的作者。
- **分类与标签**：平铺、没有层级（与页面一致，第 6 章的地址也不含父级）；分类有共享的排序值，标签按名称排列。
  名称、slug、简介（纯文本）与 SEO 字段按语言存。**没有状态**：某语言有翻译即在该语言可用（分类页、标签页的地址
  按模板生成，列出该语言已发布的文章）；需要隐藏时删除该语言版本。
- **作者**：显示名、职位、简介、slug 与 SEO 按语言存；头像、sameAs、是否公开作者页、关联账号共享。第 4 章把“职位”
  与“slug”列在“（各语言）”之外，但职位是要翻译的文本，slug 按第 4 章的数据库规则在翻译表中、(locale, slug) 唯一，
  所以都按语言存；新语言版本默认沿用已有语言的 slug。只有“公开作者页”的作者有作者页地址（第 6 章）。
  - **关联账号**：一个账号最多关联一位作者（部分唯一索引），账号删除时置空；作用是新文章的默认作者。
  - **主作者**：存于站点数据 `site.publisher.authorId`（与发布者头像同处，ADR 0008），在“设置 → 站点”的发布者中
    选择，仅管理员（`site.manage`）。发布者为 Person 时，Delivery 用主作者的显示名、头像、sameAs 与作者页生成 JSON-LD
    publisher；未指定时用配置的名称、头像与 sameAs。作者 ID 在新实例上没有意义，所以与媒体 ID 一样不进配置文件。
    主作者不能删除。
- **时间**：
  - `published_at` 是文章的发布日期（JSON-LD datePublished）：第一次发布时写入，之后再次发布不变；有 `posts.publish`
    的用户可以改为过去的时间（如补录旧文章），不能改到将来（定时发布属于 M2）。已发布的版本清空日期无效。
  - `modified_at` 是线上内容最后变化的时间（dateModified）：每次发布、以及已发布版本保存了内容或共享字段的改动时
    更新；只改发布日期不算。
  - `unpublished_at` 同 pages。
- **来源**：`posts_translations.source` 为 `manual` 或 `ai`（第 7 章“标为 AI 草稿”），按语言；M1 只存字段并在编辑页
  显示“AI 草稿”标记，“已审核后才能发布”随 `ai` 模块实现。
- **状态与 slug** 与 pages 相同：状态转换规则移到 `apps/cms/src/lib/server/content/status.ts`，两个模块共用；文章 slug
  用 `isSlug`、同一语言唯一（409 `slug_taken`）、不得是保留 slug（第 2 章）。分类、标签、作者的 slug 同样 `isSlug`
  且同类内同一语言唯一，但不检查保留 slug：它们的地址在固定段 `blog/category`、`blog/tag`、`authors` 之下，不会与
  页面或文章重名。“设置 → 前台”把某 slug 设为保留时，除了页面也检查文章。改 slug 在 M1 不写 301，审计日志记
  `posts.slug_change`、`posts.category_slug_change` 等。
- **“文章：预置分类”**（配置文件 `posts.categories`）：每个分类是 `name`（按语言）与 `slug`（按语言，或一个 slug
  用于所有已命名的语言），语言必须是内容语言，同一语言内 slug 唯一。初始化时按顺序建出这些分类；导出写当前的
  分类（只含当前内容语言的名称与 slug），所以从导出初始化的新实例得到同样的分类。简介与 SEO 是内容，不进配置。
  这一分组不存为 `settings` 行，而是从分类表读出；它在分类管理页修改，不经 `updateInstanceConfig` 写入。删除内容
  语言时，配置中该语言的分类名称一并去掉，翻译行保留，重新添加该语言即恢复。旧配置文件没有这一分组时为空。
  - 博客预设带一个默认分类：slug `general`，只建主语言版本，名称为中性词（中文“综合”，其他语言 “General”），
    由编辑改名并补其他语言。企业预设不建分类（第 2 章的企业通用种子没有）。
- **区块 9、11 选文章与分类**：页面编辑器中，精选文章可选“取最新 N 篇”或“手选”，两种都可限定分类（手选时只在该
  分类中查找）；手选的文章可排序，最多 12 篇；最新文章选数量与可选分类。文章选择器经 `/posts/picker`（`pages.edit`
  或 `posts.edit`）按页面的语言显示标题，没有该语言版本的显示其他语言的标题与状态。保存页面时，区块中的文章与分类
  必须存在，否则对应字段报错（如 `blocks.0.data.postIds.1`）。
- **导航**链接文章分类与文章（ADR 0007 延后、ADR 0009 的做法）：`nav_items` 新增 `post_category_id` 与 `post_id`
  （迁移集 `site` 的第三个迁移，外键 `ON DELETE RESTRICT`），一个菜单项只链接页面、分类、文章或 URL 之一。`site`
  清单因此依赖 `posts`。
- **删除**：
  - 文章：被菜单项或精选文章区块引用时拒绝（`in_use`，列出位置）。
  - 分类：还有文章时拒绝（`has_posts`，外键 `RESTRICT` 兜底）；被菜单项、精选文章或最新文章区块引用时拒绝（`in_use`）。
  - 标签：直接删除，并从文章中移除（外键 `CASCADE`）。
  - 作者：还有文章署名或是主作者时拒绝（`has_posts`、`primary_author`）。
  - 语言版本：最后一个不能删（`last_translation`），改为整体删除。删除时一并清除媒体引用。
- **媒体引用**（ADR 0008）：封面与头像是共享字段（引用的语言为空）；正文图片与 OG 图按语言，OG 图的用途为 `og`。
  目标类型为 `post`、`category`、`tag`、`author`（模块 `posts`）；媒体库的“引用位置”显示记录名称并链接到对应语言
  的编辑页（`media-usages.ts`）。
- **权限点**：`posts.edit`（文章的新建、编辑、提交审核、退回、添加语言版本）、`posts.publish`（发布、下线、改发布
  日期）、`posts.delete`（删除语言版本或整篇文章）、`posts.taxonomy`（分类与标签）、`posts.authors`（作者），都是
  内容权限点，默认编辑角色全有。主作者属于站点设置，仍需 `site.manage`。媒体选择器的列表接口也允许
  `posts.edit`、`posts.taxonomy` 与 `posts.authors`。
- **管理界面**：左侧菜单一项“文章”，页内分“文章 / 分类 / 标签 / 作者”。文章列表按语言、状态（含“缺少该语言”）、
  分类与标题搜索筛选。编辑页按内容语言分页签，RTL 语言的输入框为 `dir="rtl"`，右侧 SEO 面板与页面共用
  （`$lib/components/seo-panel.svelte`，路径与 schema 预览由调用方给出：文章 BlogPosting、分类与标签 CollectionPage、
  作者 ProfilePage）。分类、标签、作者的编辑页也按语言分页签，缺少的语言填写后保存即添加。
- **审计**：`posts.create`、`posts.update`（只记字段名）、`posts.slug_change`、`posts.translation_create`、
  `posts.translation_delete`、`posts.status`、`posts.publish`、`posts.unpublish`、`posts.delete`；分类、标签、作者为
  `posts.category_*`、`posts.tag_*`、`posts.author_*`（create、update、slug_change、translation_create、
  translation_delete、delete）。
- **Webhook**：清单声明 `content.published`、`content.unpublished`、`content.deleted`、`content.slug_changed`，M2 起
  发送。

## 延后

- 定时发布、工作副本、版本快照与回滚：M2。
- 改 slug 写 301、删除记 410、`content.*` Webhook 的发送、全文检索列 `search_vector`：M2。
- Delivery 端点 `/posts`、`/posts/{slug}`、`/post-categories`、`/tags`、`/authors`、`/authors/{slug}`、`/feed`，
  `seo` 对象（OG 回退到封面、hreflang、含主作者 publisher 的 JSON-LD）与富文本安全 HTML：Delivery API 项。
- 路由模板的配置与 `/routes/resolve`：路由模板项。
- 预览链接：Preview API 项。
- 关联目录项（文章字段）与富文本中的目录项卡：catalog（M4）。
- “AI 草稿须审核后才能发布”：`ai` 模块（1.2）。
- 在文章编辑页直接新建标签、批量操作：需要时再加。

## 影响

- 以后的可路由内容沿用同样的结构；没有状态的可路由分类（如 catalog 的品类若不需要状态）可以参照分类与标签。
- 新增 `posts` 配置项时同步更新 `postsConfigSchema`、`examples/config/*.yaml` 与本记录。
- 引用文章或分类的新位置（其他区块、菜单之外的链接）要加入 `references.ts` 的删除检查。
