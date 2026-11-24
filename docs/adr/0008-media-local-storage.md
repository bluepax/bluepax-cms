# 0008 media 模块（仅本地存储）：对象、衍生图、引用与站点图片

- 状态：已采纳（2026-11-24）
- 涉及：规范第 2 章（实例配置项）、第 3 章（`media`、`site`）、第 4 章（数据库）、第 5 章全章、第 9 章
  （任务与安全）、第 12 章（媒体与存储、编辑账号被拒绝）、第 13 章（默认值），`packages/storage`、
  `packages/db/src/schema/media.ts`、`apps/cms/src/lib/server/modules/media`、
  `apps/cms/src/routes/(app)/media`、`apps/cms/src/routes/uploads`、`apps/cms/src/routes/(app)/settings/branding`

## 背景

规范第 5 章规定了驱动接口、对象 key、衍生图、替换与删除规则和缓存响应头；M1 只做本地存储。规范没有规定：
多语言 alt 的存法、文件夹的结构、衍生图在请求中生成还是进队列、相同文件重复上传怎么办、“被选作 OG 图”
由谁触发、网站图标的尺寸要求、本地源的访问路径，以及标志与发布者图片存在哪里。

## 决策

- **驱动**：`packages/storage` 定义 `StorageDriver`（`put` `get` `stat` `delete` `exists` `list` `publicUrl`）
  与 `local` 驱动，按名称登记在 `DRIVERS`。key 只允许安全的相对路径；本地驱动先写临时文件再改名，删除后清理空的
  衍生图目录。根目录由 `BLUEPAX_UPLOADS_DIR` 指定，默认 `/data/uploads`（`uploads` 卷），开发时写到仓库内被忽略
  的 `data/uploads`。
- **key 中的 hash** 是文件的完整 SHA-256（十六进制）。同一内容只对应一个媒体：重复上传被拒绝（`duplicate`，并给出
  已有媒体的链接），替换成媒体库里已有的文件同样被拒绝。这样 key 唯一，删除与替换不会误删别的媒体的文件。
- **数据表**（迁移集 `media`）：`media`（当前文件的类型、大小、SHA-256、key、宽高、alt）、`media_objects`（每个对象
  在每个驱动上一行：原文件与各衍生图，状态 `pending` / `synced` / `failed`，本地写入即 `synced`）、`media_usages`
  （引用：模块、记录类型与 ID、字段、语言、用途）。另加 **`media_folders`**：第 4 章的表清单没有它，文件夹需要能
  单独存在（空文件夹），所以建表；最多 5 层，同级名称不区分大小写唯一，只能删除空文件夹。M1 不做文件夹移动。
- **多语言 alt** 存为 `media.alt` JSONB（键为 BCP 47 代码，空文本不存），与站点数据一致（ADR 0007）：媒体不是可路由
  内容，没有按语言的状态与 slug。删除内容语言后旧 alt 保留。以后 Delivery API 由 `MediaView`（URL、宽高、各语言
  alt、衍生图列表）组装输出。
- **类型与大小**：按内容嗅探（`file-type`，SVG 自行识别），只接受白名单：JPEG、PNG、GIF、WebP、AVIF、SVG；MP4、
  WebM、MOV；PDF 与 docx / xlsx / pptx / odt / ods / odp。可执行文件按文件头（MZ、ELF、Mach-O、`#!`）和文件名后缀
  拒绝。上限按类别（图片 / 文档 / 视频），默认 20 / 50 / 200 MB。SVG 先用 DOMPurify（SVG 配置，另禁
  `foreignObject`）净化再保存，本地源返回 SVG 时另加 `Content-Security-Policy: …; sandbox`。
- **衍生图在上传请求中同步生成**，不进 pg-boss：M1 还没有 worker 与队列，同步生成让上传后立即有衍生图。sharp 在
  libuv 线程池运行，不阻塞其他请求；同时最多处理 2 张图（第 9 章默认值）。宽度 480 / 960 / 1600 中小于原图的各一张，
  原图窄于 1600 时另按原宽出一张，绝不放大；AVIF 与 WebP 各一份。SVG 与动图不生成衍生图。worker 加入后改为队列
  任务，`media_objects` 的结构不变。
- **按用途派生的文件**：引用带用途 `og` 时生成 1200×630 JPG（按显著区域裁切，逐步降低质量直到 ≤ 300 KB）；用途
  `site_icon` 时生成 `favicon.ico`（16 / 32 / 48）、Apple Touch 180（白底，iOS 会把透明显示为黑色）、PWA 192 与
  512。模块保存记录前调用 `prepareMediaUse`（检查类型与用途、补齐派生文件，可能耗时，放在事务外），再在保存记录的
  事务里用 `setMediaUsages` 写引用。替换文件时按当前引用的用途重新生成。M1 中还没有模块把图片选作 OG 图（随 seo、
  pages、posts 加入），机制由测试覆盖。
- **网站图标**须为至少 512×512 的正方形 PNG（最大的 PWA 图标是 512）；被用作网站图标的媒体只能替换成同样的 PNG。
- **替换**保留媒体 ID、名称、alt 与引用；新文件须与原文件同类（图片 / 视频 / 文档）。新文件与衍生图先写入，事务内
  换掉对象记录，提交后立即删除旧对象。`media.replaced` Webhook 在 M2 实现后发送（受影响路径由 `media_usages` 计算）。
- **删除**：有引用时拒绝（`in_use`），详情页列出引用位置并给出链接；`media_usages` 对 `media` 的外键为 `restrict`，
  并发写入引用也不会删掉在用的文件。
- **本地源**在 `/uploads/{key}`，无需登录；只返回 `media_objects` 中登记的对象。响应头：
  `Cache-Control: public, max-age=<天数 × 86400>, immutable`、`X-Robots-Tag: noindex`、`X-BluePax-Origin: local`、
  `ETag`（对象 SHA-256），支持单段 `Range`（视频拖动）。这些请求不读取也不刷新会话，响应不带 `Set-Cookie`。全局安全
  头不再覆盖路由自己设置的 `X-Robots-Tag`。M1 返回相对路径 `/uploads/…`；绝对 URL 的来源随 Delivery API 决定。
- **存储设置**（“媒体库 → 存储设置”）放在实例配置的 `storage` 分组：`mode`（M1 只有 `local`）、`cacheDays`
  （默认 365）、`uploadLimitsMb`（图片 / 文档 / 视频）。第 13 章说默认值“均可在实例配置中修改”，所以缓存天数与上传
  上限进入配置文件与导出；旧配置文件不写这两项时取默认值。修改后本地源下一次请求即生效。
- **权限**：`media.edit`（内容操作，默认编辑角色有）与 `media.storage`（存储设置，仅管理员）。迁移集 `media` 的第一个
  迁移给已有实例的 `editor` 角色补上 `media.edit`；新实例按清单生成。媒体选择器的列表接口 `/media/picker` 允许
  `media.edit` 或 `site.manage`。页面、表单动作与接口都先检查权限，返回 403，并有覆盖全部媒体路由的测试。
- **站点图片**：标志与网站图标存于 `site.branding`（与主题色一起，新页“设置 → 品牌外观”），发布者的标志或头像存于
  `site.publisher`；值是媒体 ID，并写入 `media_usages`（模块 `site`）。第 2 章把“标志或头像”列在配置文件的发布者
  配置中，但媒体不进种子与配置文件（第 2 章“种子分层”），媒体 ID 在新实例上没有意义，所以它与 ADR 0007 的其他站点
  数据一样只在后台设置，不写入配置文件与导出。`site` 清单因此依赖 `media`。
- **审计**：`media.upload`、`media.update`（只记字段名）、`media.replace`（前后的类型、大小、SHA-256）、
  `media.delete`、`media.folder_create` / `folder_update` / `folder_delete`、`media.storage_update`（前后值）。
- **Webhook**：清单声明 `media.replaced` 与 `media.origin_changed`，M2 起发送。

## 延后

- R2 驱动、镜像与回填、分发源切换、存储状态的未同步与失败数、全量校验、前台源站检查与 `storage_checks`：M3。
- `media.replaced` / `media.origin_changed` 的发送：M2（Webhook）。
- 衍生图改由 pg-boss 任务生成：随 worker 加入。
- 媒体的 Delivery API 输出与绝对 URL（`GET /site` 中的标志、网站图标与发布者图片）：随 Delivery API。
- 把图片选作 OG 图：随 seo（全局默认分享图）、pages、posts 的 SEO 面板。
- 部署：adapter-node 默认 `BODY_SIZE_LIMIT` 为 512 KB，镜像需设到不小于最大上传上限（默认 200 MB，另加表单开销），
  并考虑只对上传路由放宽；随 Dockerfile 一项处理。上传在内存中处理，所以上传上限最多 1024 MB。
- 文件夹移动、批量操作、按类型筛选的列表页签：需要时再加。

## 影响

- 其他模块引用媒体时调用 `prepareMediaUse` 与 `setMediaUsages`，删除记录时清空其引用；在 `media-usages.ts` 登记
  引用位置的名称与后台链接。
- 新增 `storage` 配置项时同步更新 `storageConfigSchema`、`examples/config/*.yaml` 与本记录。
