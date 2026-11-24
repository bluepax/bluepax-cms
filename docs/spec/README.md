# BluePax Headless CMS 设计规范

> 本文是 BluePax CMS 的唯一实现依据（见第 1 章）。功能变更先改本文，再改代码。

## 1. 概述

BluePax CMS 是开源（MIT）的通用 Headless CMS，面向企业官网与博客：只提供管理界面与接口，不渲染任何公开页面；每个站点的前台自行实现，只经第 6 章的接口与区块 JSON Schema 对接。

本文是唯一实现依据，只有中文版，不另做译本。代码只有一份：`git@github.com:bluepax/bluepax-cms.git`，所有站点部署同一代码的实例，站点间的差异只在实例配置与数据。代码与本文不一致时以本文为准；功能变更先改本文，再改代码（本文以 Markdown 随代码存于 `docs/spec/`）。

**与前台的边界**

- 只有三种连接：取数与提交（Delivery / Event API，启用询盘时另有 Inquiry API）、发布通知（Webhook）、预览（签名 Token）。
- 前台不连数据库、不引用 CMS 代码，只依赖 `@bluepax/cms-client`（或按 OpenAPI 生成的客户端）与区块 JSON Schema；渲染、样式与页面全部由前台实现。
- 两边各自发版，接口版本号是唯一的兼容约定；同机、同一 compose 部署只是部署选择。
- 管理界面、登录页、发件人、OpenAPI 标题统一用 “BluePax CMS”；前台任何位置不出现该名称。

**硬性约束**

| 项 | 要求 |
| --- | --- |
| 形态 | Headless；一个站点一个实例（独立数据库、域名、存储与账号），一个实例只对接一个前台；不做多租户 |
| 中立 | 代码与种子中不出现任何公司名称、文案或真实内容，不写死任何行业的业务类型、目录类型或字段 |
| 技术栈 | SvelteKit + Node.js（TypeScript）；禁止 PHP |
| 数据 | PostgreSQL；不使用 Redis 或外部托管数据库 |
| 文件 | 抽象存储层；默认本地，可加 Cloudflare R2 作镜像与分发源，本地始终保留完整副本 |
| 部署 | 全部容器化，docker compose |
| 语言 | 管理界面 zh / en；内容语言由实例配置（BCP 47 代码），支持 RTL |
| 契约 | 接口与区块 JSON Schema 按版本发布，是对外唯一契约 |

## 2. 站点类型与实例配置

初始化时选择“企业”或“博客”，系统套用对应预设；预设只决定初始状态，之后模块可逐项开关，不形成两套代码。类型记录在设置中、可改，改动不会自动开关模块或删除数据。

| 项 | 企业 | 博客 |
| --- | --- | --- |
| 默认启用的可选模块 | `catalog`、`inquiries`、`regions`、`tracking`、`insights`、`ai` | `tracking`、`insights`、`ai` |
| 可用区块 | 13 种 | 1–6、9、11–13；Hero 的选型条、联系 CTA 的表单在对应模块关闭时不可用 |
| 发布者（JSON-LD publisher） | Organization：品牌参数与法律主体 | Person：主作者；可改为 Organization |
| 仪表盘 | 待审草稿、新询盘、搜索与转化摘要 | 待审草稿、近期发布、热门文章、搜索摘要 |
| 通用种子 | 区块定义、默认角色与权限点、一条默认归属规则 | 区块定义、默认角色与权限点、一个默认文章分类 |

博客需要联系表单时开启 `inquiries`，需要作品或产品展示时开启 `catalog`。

**初始化向导**（首次访问且尚无管理员时出现，完成后永久关闭）

1. 输入 `.env` 中的一次性安装口令。
2. 选择站点类型。
3. 选择内容语言与主语言、管理界面语言，填写站点名称与前台基础 URL。
4. 创建首个管理员。
5. 写入预设种子；存储自动设为仅本地（R2 之后在后台添加）。

也可以用部署仓库中的实例配置文件（YAML）无人值守初始化，此时向导只创建首个管理员。只用某实例的配置文件从零初始化，必须得到与线上相同的模块、语言、目录、字段和字典。后台改过配置后，管理员在“设置 → 实例配置”导出当前配置（YAML，与配置文件格式相同，不含密钥）回写部署仓库，保持两者一致；导入只在初始化时进行。

**实例配置项**（配置文件与后台设置一一对应）

| 分组 | 配置项 |
| --- | --- |
| 站点 | 类型、名称、发布者（Organization / Person 及名称、标志或头像、sameAs）、品牌词、前台显示时区、即时通讯（渠道、号码、各语言预填文案） |
| 语言 | 内容语言、主语言、书写方向；管理界面语言 |
| 前台 | 前台基础 URL（一个实例只对接一个前台）；路由模板（见第 6 章）；保留 slug（前台固定栏目占用的路径，页面与文章 slug 不得重名；路由模板中的固定段自动保留） |
| 模块与区块 | 启用的可选模块；可用区块及区块内可选功能 |
| 存储 | 模式（仅本地 / 本地 + R2）与分发源 |
| 目录 | 目录类型、品类种子、规格字典、品牌字典（见第 4 章） |
| 询盘 | 业务类型、表单字段、归属规则（见第 8 章） |
| 文章 | 预置分类 |
| 运营 | 追踪、看板（默认国家、品牌词）、AI（默认起稿语言）、日志保留天数 |

**种子分层**：企业与博客两套预设及其通用种子随代码发布（`packages/presets`）；各站点的配置文件放在各自的私有部署仓库；公司资料、目录项、文章、媒体、法律文本不进种子，上线后在后台录入。开发环境可用单独命令加载虚构测试数据，该命令不随生产部署执行。

## 3. 模块与权限

CMS 由 8 个核心模块和 6 个可选模块组成，所有实例沿用同一张模块与权限表。

**模块规范**：每个模块用清单（manifest）注册，声明 ID、版本与依赖、数据表与迁移、权限点 `模块ID.动作`、管理菜单、API 端点、提供的区块、后台任务、Webhook 事件 `模块ID.对象.事件`、设置项与默认值；核心只依赖清单。新功能先归入某个模块，新模块先在下表登记再实现。可选模块关闭后，菜单隐藏、接口返回 404、任务与区块停用，数据保留。

| 模块 ID | 类型 | 功能 | 编辑 |
| --- | --- | --- | --- |
| `dashboard` | 核心 | 待审草稿、近期发布及各模块提供的卡片；默认布局随站点类型 | ✓ |
| `site` | 核心 | 站点类型、名称、语言、发布者、法律主体与地点（可空）、联系方式、即时通讯（渠道、号码、各语言预填文案）、社媒、导航、页脚、标志、网站图标（由正方形 PNG 自动生成 favicon / Apple Touch / PWA 图标）与 theme-color、时区、SMTP 发件设置 | ✗ |
| `pages` | 核心 | 区块页编排、版本、预览、发布 | ✓ |
| `posts` | 核心 | 文章、分类、标签、作者资料、定时发布 | ✓ |
| `media` | 核心 | 上传、文件夹、多语言 alt、衍生图、引用关系；存储设置仅管理员 | ✓ |
| `seo` | 核心 | 全局默认（含默认 OG）、逐条字段、301（含 CSV 导入）、404 日志、robots、sitemap 状态、llms.txt 预览、站点验证标签、内容体检；robots 与站点验证标签仅管理员 | ✓ |
| `api` | 核心 | 前台（基础 URL）及其密钥、Management Token、OpenAPI 文档 | ✗ |
| `users` | 核心 | 账号、角色、权限点、两步验证、操作日志 | ✗ |
| `catalog` | 可选 | 目录类型、品类、目录项、规格字典、品牌字典；类型与字典定义仅管理员 | ✓ |
| `inquiries` | 可选 | 询盘列表、状态、备注、指派、导出；字段、归属、通知设置仅管理员 | ✓ |
| `regions` | 可选 | 区域与分部 | ✗ |
| `tracking` | 可选 | GTM、自定义代码、转化事件开关 | ✗ |
| `insights` | 可选 | SEO / GEO 看板；数据源凭证与费用上限仅管理员 | ✓ |
| `ai` | 可选 | AI 写作与翻译；供应商、密钥与提示词仅管理员 | ✓ |

**角色**：角色是权限点的集合，增加角色不改代码。默认管理员（全部权限）与编辑（上表“编辑”为 ✓ 的模块的内容操作，不含设置与用户管理）。账号只能由管理员创建，不提供邀请或自助注册。

**管理界面**：zh / en 按用户切换；左侧菜单 + 列表 / 表单，桌面优先、平板可用，加载用骨架屏；编辑页按内容语言分页签、右侧固定 SEO 面板，RTL 语言输入框自动 `dir="rtl"`；“关于”页显示版本、build 号、编译时间与提交号。

**通用能力**

- 状态：草稿 / 待审核 / 已发布 / 已下线，按语言分别管理；定时发布；带签名的预览链接（在前台预览工作副本）。
- 工作副本与版本：线上数据只由“发布”写入。编辑已发布内容时，改动存入该内容的工作副本（`drafts`，含共享字段与各语言字段），发布前线上不变；定时发布同样从工作副本发布。发布某一语言时，共享字段（规格、图库、品类等）一并生效，影响其他已发布语言时先提示。每次发布生成一个版本快照（共享字段 + 该语言字段）存入 `revisions`，每条内容每种语言保留最近 50 个；回滚是把所选快照载入工作副本，再按正常流程审核发布，不直接改线上。
- SEO 面板（页面、文章、目录项、品类、作者，按语言）：slug、meta title / description、canonical、robots、OG、目标关键词、一句话结论、搜索结果与 schema 预览。OG 留空时回退：OG 文字 → meta → 全局默认；OG 图 → 封面或首图 → 全局默认分享图。
- 富文本只允许语义元素（H2–H4、段落、列表、表格、引用、图片、链接、目录项卡），存 JSON，不允许内联样式和自定义 HTML。
- slug 修改自动写入 301；301 表保存与导入时拒绝循环、合并多级跳转为一次直达。
- 账号：Argon2id、密码至少 12 位、可选 TOTP、登录限速与锁定、会话存库；配置 SMTP 后可邮件重置密码，否则由管理员重置。

## 4. 内容模型、区块与数据库

内容分两类：字段固定的结构化实体，和由标准区块拼装的区块页。区块数据结构由 CMS 固定并以 JSON Schema 发布，HTML、样式与 schema.org 输出由前台实现；不提供自定义 HTML 区块。页面为平铺结构（无父子层级），层级关系由导航表达。

**标准区块**（13 种；新增类型随版本发布）

| # | 区块 | 字段 | 依赖 |
| --- | --- | --- | --- |
| 1 | Hero | 标题、副标题、背景图或视频、≤ 2 个按钮；可选规格选型条（默认关闭） | 选型条需 `catalog` |
| 2 | 图文介绍 | 标题、正文、图片及位置、可选按钮 | — |
| 3 | 卡片组 | 标题、N 张卡片（图标 / 标题 / 描述 / 链接），2–4 列 | — |
| 4 | 流程步骤 | 标题、编号步骤 | — |
| 5 | 数字指标 | N 组数值 + 单位 + 说明 | — |
| 6 | Logo 墙 | 标题、Logo（名称 / 图片 / 链接） | — |
| 7 | 品类入口 | 目录类型，自动读取已发布品类 | `catalog` |
| 8 | 目录项列表 | 手选或按品类自动取 N 个 | `catalog` |
| 9 | 精选文章 | 从指定分类手选或取最新 N 篇 | — |
| 10 | 服务网络 | 法律主体与区域分部 | `regions` |
| 11 | 最新文章 | 数量、可选分类 | — |
| 12 | 联系 CTA | 标题、说明、默认业务类型、显示表单 / 即时通讯按钮 / 普通链接 | 表单需 `inquiries` |
| 13 | 富文本 | 标题 + 正文 | — |

**结构化实体**

- 文章：标题、摘要、正文、封面、分类、标签、作者（可多位）、Key takeaways、关联目录项、发布与更新时间、来源（人工 / AI 草稿）。
- 作者：显示名与简介（各语言）、slug、头像、职位、sameAs、是否公开作者页；可关联后台账号。博客指定一位主作者作为发布者。
- 法律主体（可空）：法定名称、角色、登记号与税号（带公开开关）、联系方式；分支地点（地址、电话、邮箱、坐标、营业时间）。
- 目录类型：key（拉丁小写，用于接口路径）、各语言名称、排序、启用状态、默认业务类型；数量不限，如 `products`、`services`、`portfolio`。
- 品类：所属目录类型、名称与简介、slug、封面、排序、是否显示筛选栏。
- 目录项（各目录类型共表）：品类、名称、编号 / 型号（可选）、一句话结论、描述、图库、规格、品牌、应用场景、资料下载、相关项、默认业务类型、排序；可复制到另一目录类型。
- 规格定义：名称、单位、数值 / 文本 / 枚举及选项、可否筛选、是否上卡片、适用的目录与品类；不写死任何行业字段，选项型属性用枚举表达。品牌字典可关闭。
- 区域与分部：区域分组；分部含名称、公司、国家 / 城市、关系类型（选项可配置）、业务标签、覆盖范围、联系方式、Logo、链接方式（外链 / 联系该分部 / 仅展示）。
- 品牌事实库：品牌、主体、服务范围等确定事实，供 AI 引用。

**数据库**：每个实体一张主表 + 一张 `_translations` 表（entity\_id、locale、slug、标题、正文、SEO、状态、发布时间），唯一约束 (entity\_id, locale) 与 (locale, slug)；下表省略翻译表。

| 模块 | 表 |
| --- | --- |
| 核心 | users、roles、role\_permissions、sessions、audit\_log、drafts、revisions、instance\_modules、settings、任务队列表 |
| site / pages / posts | legal\_entities、entity\_locations、nav\_items；pages、page\_blocks；posts、post\_categories、tags、authors |
| media / seo / api | media、media\_objects、media\_usages、storage\_checks；redirects、not\_found\_log；frontends、api\_tokens、webhook\_deliveries |
| catalog | catalog\_types、categories、catalog\_items、spec\_definitions、spec\_options、catalog\_item\_specs、brands |
| inquiries | business\_types、inquiry\_field\_definitions、inquiries（自定义字段值存 JSONB `fields`）、inquiry\_notes、inquiry\_routing\_rules、notification\_log |
| regions / insights / ai | regions、regional\_offices；gsc\_daily、ga4\_daily、crawler\_hits\_daily、geo\_prompts、geo\_runs、geo\_results；ai\_providers、ai\_prompt\_templates、ai\_jobs、brand\_facts |

- 索引：外键 B-tree；列表 (locale, status, published\_at DESC)；目录 (catalog\_type\_id, category\_id, sort\_order)；`catalog_item_specs` 的 (spec\_id, num\_value) 与 (spec\_id, text\_value)；`inquiries.fields` GIN；`redirects.from_path` 唯一。
- 全文检索：翻译表生成列 `search_vector`（按语言选检索配置）+ GIN；型号模糊匹配用 pg\_trgm；阿拉伯语在生成检索列与处理查询词时做同一套归一化（去音标与延长符，أ / إ / آ → ا，ى → ي，ة → ه），只作用于检索列与查询词，存储和显示的原文不变。
- 时间一律存 UTC（timestamptz）；结构只经迁移修改，模块迁移在模块目录内，关闭模块不删表；日志类表按保留期定期清理。

## 5. 媒体与存储

所有文件读写经抽象存储层，业务代码不直接操作路径或调用对象存储 SDK。初始化后默认仅本地；接入 Cloudflare R2 后，上传的文件在本地之外再存一份到 R2，并可选择前台资源从哪一端分发。

- **驱动接口**：`packages/storage` 定义 `StorageDriver`（`put`、`get`、`stat`、`delete`、`exists`、`list`、`publicUrl`）。内置 `local`（`/data/uploads`）与 `r2`（S3 兼容 API：Account ID、Access Key ID、Secret、Bucket、公开域名）。新增驱动只实现接口并登记。
- **对象 key**：原文件 `{yyyy}/{mm}/{hash}.{ext}`，衍生图 `{yyyy}/{mm}/{hash}/{variant}.{ext}`；本地路径与 R2 key 一一对应。
- **模式**：仅本地（默认），或本地 + R2。本地始终是主副本，R2 只作镜像与分发；关闭 R2 不丢数据，分发源自动回到本地。
- **写入**：上传先写本地并入库（立即可用），再由 worker 把原文件与全部衍生图上传 R2（失败退避重试）。`media_objects` 记录每个对象在各驱动上的状态（pending / synced / failed）、大小、SHA-256 与同步时间；删除与替换同样同步。R2 对象带 `Content-Type` 与 `Cache-Control`（时长见下文“缓存与收录”）。
- **接入 R2**：“媒体库 → 存储设置”填写凭证并“测试连接”（写入、读取、删除测试对象，并经公开域名访问）；通过后启用镜像，worker 回填已有文件并显示进度。建议使用只对该 bucket 有读写权限的 API Token，凭证加密入库。
- **分发源**：管理员设为本地或 R2；回填完成前不能切到 R2。接口返回的媒体 URL 前缀随之切换，`GET /site` 返回 `mediaOrigin`，切换后发 Webhook 让前台全量刷新；单个对象在 R2 未同步时回退到本地 URL。
- **存储状态**：当前模式与分发源、各驱动对象数与容量、未同步与失败数；可重试失败项、全量校验（比对 key 与校验和）。
- **前台源站检查**：输入前台页面 URL（默认取前台的首页与最近发布内容），CMS 拉取 HTML、提取全部媒体地址，按域名归类为本地 / R2 / 其他，并逐个发 HEAD 记录状态码与响应头（本地源响应带 `X-BluePax-Origin: local`）；报告给出来源占比，标出与设置不一致或无法访问的地址，存入 `storage_checks`。也可经 Management API 触发。
- **媒体处理**：图片生成约 480 / 960 / 1600 宽的 AVIF / WebP 衍生图；被选作 OG 图的图片另生成 1200×630 JPG（约 300 KB 以内），接口 `seo` 中的 OG 图一律返回这张；视频与 PDF 原样保存。校验 MIME 与大小，禁止可执行文件；被引用的媒体禁止删除并列出引用位置。替换文件保留同一媒体 ID：新文件按新 hash 生成新 key 与衍生图，旧对象（原文件与衍生图，本地与 R2）立即删除，并发 `media.replaced` Webhook（受影响路径按 `media_usages` 计算），前台据此刷新引用它的页面。
- **缓存与收录**：管理员在“存储设置”按天设置媒体缓存时长（默认 365 天），本地源与 R2 对象都返回 `Cache-Control: public, max-age=<天数 × 86400>, immutable`；修改后本地源立即生效，R2 上已有对象由 worker 重写元数据。媒体不进搜索引擎：本地源响应带 `X-Robots-Tag: noindex`，R2 公开域名在 Cloudflare 用响应头规则加同一个头（部署文档给出示例）。

## 6. 接口契约与前台接入

接口以 OpenAPI 3.1 描述（附在线调试界面），当前为 v1。SDK `@bluepax/cms-client` 与区块 Schema 包 `@bluepax/cms-blocks` 随每个版本发布到 GitHub Packages 的 npm 仓库（`https://npm.pkg.github.com`，版本号与 CMS 一致），包为公开（Public）。GitHub Packages 安装公开包同样需要鉴权：前台在 `.npmrc` 中写入 `@bluepax:registry=https://npm.pkg.github.com` 与 `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`，本地开发用带 `read:packages` 权限的经典个人令牌（classic PAT），前台仓库的 Actions 用其自带的 `GITHUB_TOKEN`（需先在包设置中授予该仓库读取权限），然后用 `pnpm add @bluepax/cms-client` 安装；本地联调用 `pnpm link`，仓库内的最小示例前台直接引用 workspace 包。其他技术栈按 OpenAPI 生成客户端。

| 接口 | 方向 · 鉴权 | 内容 |
| --- | --- | --- |
| Delivery `GET /api/delivery/v1/…` | 前台 → CMS；Delivery Token（范围 `delivery:read`） | 已发布内容与站点配置 |
| Event `POST /api/delivery/v1/events` | 前台 → CMS；Delivery Token（范围 `events:write`） | 404、AI 爬虫访问等前台事件 |
| Preview `GET /api/delivery/v1/preview/{token}` | 前台 → CMS；短时签名 Token | 草稿内容 |
| Inquiry `POST /api/inquiry/v1/inquiries` | 仅启用 `inquiries`；表单 Key + 限速 + 可选 Turnstile | 提交询盘；201 / 422（逐字段错误）/ 429 |
| Webhook | CMS → 前台；HMAC-SHA256 签名，带时间戳与投递 ID 防重放 | 见下文事件表 |
| Management `/api/manage/v1/…` | 内部系统 → CMS；Bearer Token，按范围授权 | 读内容、读写询盘、系统状态、源站检查；不供公开前台 |

**约定**

- 只允许服务端调用，Token 与表单 Key 不下发到浏览器。提交询盘时，前台把访客 IP 放入 `X-BluePax-Client-IP`（取自 Cloudflare 的 `CF-Connecting-IP`；前台不在 Cloudflare 后面时取网关给出的真实 IP），把访客 User-Agent 放入 `X-BluePax-Client-UA`；CMS 只在表单 Key 有效时信任这两个头，询盘限速、Turnstile 校验与询盘记录都以它们为准。
- JSON、camelCase、ISO 8601（UTC）；按 `locale` 返回单语版本，未发布返回 404；未填字段返回空值。
- 列表分页 `page` / `pageSize`（默认 20，上限 100）；错误为 `{ error: { code, message, details } }`；响应带 `ETag` / `Last-Modified`。409 表示唯一性冲突（slug、key）或编辑冲突（工作副本已被他人更新），410 表示内容已永久删除。
- 富文本同时返回 JSON 与安全 HTML；媒体返回绝对 URL（按当前分发源）、宽高、各语言 alt 与衍生图。
- 可路由内容返回 `seo` 对象（title、description、canonical、robots、已回退补全的 OG、hreflang、JSON-LD 字段，含 publisher）。
- 前台遇到未知区块类型忽略并记录，不报错。
- 一个实例只对接一个前台：登记其基础 URL，并为它签发 Delivery Token（默认带 `delivery:read` 与 `events:write`）、表单 Key、Webhook 地址与密钥、预览密钥。
- v1 只增字段、不删不改；破坏性变更进 v2，v1 至少保留 12 个月。
- `/api/*` 靠 Token、限速与 CORS 白名单保护；默认限速：每个 Delivery Token 1200 次 / 分钟，询盘每个访客 IP（`X-BluePax-Client-IP`）5 次 / 10 分钟（可配置）。

**路由模板**（实例配置“前台”分组，经 `GET /site` 下发）

CMS 用路由模板生成 canonical、hreflang、sitemap、RSS、llms.txt、富文本内链、Webhook 的受影响路径与源站检查地址，并据此解析 `/routes/resolve`；前台按同一份模板实现路由，不自行拼地址。企业与博客预设的默认模板相同，均可修改。

| 内容 | 默认模板 | 说明 |
| --- | --- | --- |
| 首页 | `/{locale}` | 指定一个页面为首页；`/` 301 到主语言首页 |
| 页面 | `/{locale}/{slug}` | 平铺，层级由导航表达 |
| 文章 | `/{locale}/blog/{slug}` | — |
| 文章分类 / 标签 | `/{locale}/blog/category/{slug}`、`/{locale}/blog/tag/{slug}` | — |
| 作者 | `/{locale}/authors/{slug}` | 只生成“公开作者页”的作者 |
| 目录类型 / 品类 / 目录项 | `/{locale}/{type}`、`/{locale}/{type}/{category}`、`/{locale}/{type}/{category}/{slug}` | `{type}` 为目录类型 key，`{category}` 为品类 slug |

- 占位符只有 `{locale}`、`{slug}`、`{type}`、`{category}`，其余为固定段；每种内容语言都带前缀，地址一律小写、不带末尾斜杠，带斜杠的请求由前台 301 到不带斜杠的地址。
- 保存模板时校验任意两类内容不会生成相同地址；模板中的固定段（如 `blog`、`authors`）自动加入保留 slug。
- slug、品类、目录类型 key 或模板本身修改后，CMS 为所有受影响的已发布地址写入 301；改模板前先显示受影响的地址数并要求确认。
- 可路由内容永久删除后，其地址在 301 表中记为 410，管理员可改为 301 指向新地址。
- 某语言未发布时，该语言的地址返回 404，不回退到其他语言；`seo.hreflang` 只列已发布语言，`x-default` 指向主语言版本。

**Delivery 端点**（前缀 `/api/delivery/v1`；可选模块关闭时其端点返回 404）

| 端点 | 内容 |
| --- | --- |
| `GET /site` | 站点类型、发布者、语言、主体与地点、联系方式、社媒、导航、页脚、品牌参数、已启用模块、前台基础 URL 与路由模板、保留 slug、目录类型、业务类型、询盘表单 JSON Schema、即时通讯、追踪设置、`mediaOrigin` |
| `GET /routes/resolve?path=` | 内容类型与 ID、各语言对应地址、301 目标或 410 标记 |
| `GET /pages/{slug}` | 区块页 |
| `GET /posts`、`/posts/{slug}`、`/post-categories`、`/tags`、`/authors`、`/authors/{slug}` | 文章、分类、标签、作者 |
| `GET /catalog/{type}/categories`、`/items`、`/items/{slug}` | 目录；列表可按规格与品牌筛选并返回可用筛选项 |
| `GET /regions` | 区域与分部 |
| `GET /search?q=` | 站内搜索 |
| `GET /seo/sitemap`、`/seo/robots`、`/seo/llms`、`/seo/redirects`、`/feed` | sitemap、robots、llms.txt、301 表、RSS 的数据 |
| `GET /schema/blocks` | 区块 JSON Schema |

**Webhook 事件**（载荷含事件名、时间、内容类型与 ID、locale、受影响的路径；头 `X-BluePax-Event`、`X-BluePax-Delivery-Id`（每次投递唯一，重试时不变）、`X-BluePax-Timestamp`（Unix 秒）与 `X-BluePax-Signature`（对 `{timestamp}.{原始请求体}` 计算 HMAC-SHA256，每次重试用新时间戳重新签名）；失败按指数退避重试，最多 8 次，记入 `webhook_deliveries`）

| 事件 | 触发 |
| --- | --- |
| `content.published` / `content.unpublished` / `content.deleted` | 任一可路由内容的发布、下线、永久删除 |
| `content.slug_changed` | slug 修改（含旧路径与新路径） |
| `site.updated` | 站点设置、导航、页脚、模块开关变更 |
| `media.origin_changed` | 媒体分发源切换 |
| `media.replaced` | 媒体文件被替换（含受影响路径，旧地址已失效）；默认发送 |
| `redirects.updated` | 301 表变更 |
| `inquiry.created` | 新询盘（仅启用 `inquiries`，发往询盘通知地址，不发前台） |

**接收端校验**：签名用常量时间比较；`X-BluePax-Timestamp` 与本机时间相差超过 5 分钟拒收；`X-BluePax-Delivery-Id` 在 24 小时内去重，重复投递直接返回 2xx、不再处理。`@bluepax/cms-client` 提供 `verifyWebhook()` 完成这三步。

**健康检查**：`GET /api/health`（无鉴权）返回总体状态、版本与 build 号；`GET /api/manage/v1/system/status`（范围 `system:read`）返回各检查项 `ok` / `warn` / `fail`：数据库、worker 心跳、队列积压与失败任务、备份与异地同步、磁盘、存储同步与最近一次源站检查、邮件与 Webhook 成败数、数据源同步、AI 用量、已启用模块。`POST /api/manage/v1/storage/check` 触发前台源站检查。系统不主动推送告警。

**前台接入清单**（技术栈不限）

1. 在“接入与 API”填写前台基础 URL，取得 Token、表单 Key、Webhook 密钥与预览密钥。
2. 按 `/site` 下发的路由模板实现路由，按路径调 `/routes/resolve` 并服务端渲染；301 / 404 / 410 按解析结果返回。
3. 为可用的每种区块实现渲染组件。
4. 按 `seo` 对象输出 `<head>` 与 JSON-LD，按 `/seo/*` 数据生成 sitemap、robots、llms.txt、RSS。
5. 实现 Webhook 接收端点（用 `verifyWebhook()` 验签、校验时间戳并按投递 ID 去重，再按路径刷新缓存）与预览路由（noindex、不缓存）。
6. 404 经 Event API 上报；启用 `inquiries` 时按表单 schema 渲染表单并经服务端转发提交；追踪代码按 `/site` 输出。
7. CMS 不可达时用缓存渲染已缓存页面，其余返回 503（带 `Retry-After`）。

## 7. SEO / GEO、看板与 AI

CMS 提供前台输出 SEO 与 GEO 所需的全部数据（`seo` 对象与 `/seo/*` 端点）；看板与 AI 分别在可选模块 `insights`、`ai` 中。

**看板**：worker 定时拉取或解析后存入本地库，页面只查本地，外部接口不可用时仍显示历史。

| 看板 | 面板 | 内容 | 数据源 |
| --- | --- | --- | --- |
| SEO | 搜索表现 | 点击、展示、CTR、排名，按查询词、页面、国家、设备、语言拆分 | GSC（每日） |
| SEO | 机会词 | 展示高、CTR 低、排名 5–20 的词，可一键转 AI 选题 | GSC |
| SEO | 收录状态 | sitemap 状态、重点页索引（受 URL Inspection 配额限制） | GSC |
| SEO | 流量与转化 | 会话、渠道、着陆页、热门文章、转化事件数 | GA4 |
| SEO | 内容体检 | 缺语言版本、缺 meta、标题过长或重复、缺 alt、正文过短、无内链、坏链 | 本地扫描 |
| SEO | 技术健康 | 404 排行、301 命中、近期发布 | 本地日志 |
| GEO | AI 爬虫抓取 | GPTBot、OAI-SearchBot、ClaudeBot、PerplexityBot、Google-Extended、Bingbot 等的抓取次数、页面、状态码，从未被抓取的页面 | 前台经 Event API 上报 |
| GEO | AI 引荐流量 | 来自 chatgpt.com、perplexity.ai、gemini.google.com、copilot.microsoft.com、claude.ai 等的会话与转化 | GA4 |
| GEO | AI 引用监测 | 问题库定期询问各引擎，记录是否提及品牌词、是否引用本站、被提及的竞品，输出趋势 | 各引擎的监测适配器（联网搜索） |
| GEO | 内容就绪度 | 一句话结论、schema、更新日期、表格化参数 | 本地扫描 |

引用监测只是趋势指标：API 回答与用户在客户端看到的不完全一致；每次监测有费用，后台设频率（默认每周）与月度费用上限；问题库由使用者录入，不进种子。

**AI 爬虫统计**：前台中间件把 UA 命中爬虫列表的请求经 Event API 批量上报（路径、状态码、UA、IP、时间），CMS 不读取网关日志，同机与异机部署做法相同。爬虫列表在后台维护，每个爬虫配置 UA 规则与核验方式（官方公布的 IP 段地址或反向 DNS 域名），看板分别显示“已核验”与“未核验”的访问。统计口径是到达前台源站的请求：Cloudflare 默认不缓存 HTML，若对 HTML 开启了边缘缓存，命中缓存的抓取不计入。

**引用监测引擎**：各家联网搜索的调用方式不同，不能只靠 OpenAI 兼容接口，因此每个引擎一个适配器（`GeoEngine`：提问，取回答文本与引用链接）；v1 内置 OpenAI、Anthropic、Perplexity、Google Gemini 四个适配器。监测引擎属于 `insights`，在看板设置中单独配置（引擎、密钥、模型），与 AI 写作、翻译的供应商分开，费用计入看板的月度上限。

**AI 供应商**（仅管理员）：OpenAI 兼容接口（Base URL + Key + 模型）或 Anthropic 接口，可添加多个，分别指定写作与翻译的默认模型（引用监测用上文的监测引擎）；密钥 AES-256-GCM 加密入库、界面只显示末四位；记录每次调用的模型、token 与估算费用，可设月度上限。

**AI 写作与翻译**

1. 选题：手动输入，或从机会词、未被提及的监测问题带入。
2. 简报：关键词、搜索意图、读者、大纲、引用的目录项与内链、起稿语言。
3. 生成草稿（后台任务）：标题、slug、meta、摘要、Key takeaways、正文、alt 建议；注入品牌事实库与所引目录项规格，超出范围的数值与标准编号高亮提示核实。
4. 审核：标为“AI 草稿”，点“已审核”后才能发布，没有任何自动发布路径。
5. 翻译：在内容语言之间逐字段生成草稿（含 SEO 与 alt），编号、数值、单位、品牌不译，同样审核后发布；源语言在译文发布后被修改时，译文标“可能已过时”。提示词模板由管理员维护。

## 8. 询盘、通知与追踪

询盘是可选模块 `inquiries`（企业默认开启，博客默认关闭，可作联系表单）。关闭时 Inquiry API 返回 404、`/site` 不下发表单 schema、仪表盘与看板不显示询盘内容；即时通讯属于 `site` 模块，不受影响。邮件与 Webhook 由 worker 异步发送。

**表单字段**

- 固定字段：姓名、留言、语言、来源页面、归因参数、关联目录项（可空）、归属、状态、备注。
- 可选内置字段（可开关、可设必填）：公司、邮箱、电话、国家 / 城市、业务类型；邮箱与电话至少必填一项。
- 自定义字段：key（保存后不可改）、各语言标签与提示、类型（单行 / 多行文本、数字、日期、日期范围、单选、多选、国家）、选项、必填、校验规则、排序、仅对哪些业务类型显示。停用后不再出现，历史值保留。
- 字段定义以 JSON Schema 经 `/site` 下发，Inquiry API 用同一份 schema 校验；不支持附件。

**处理与通知**

- 业务类型：实例定义的选项列表，可为空；目录类型与目录项可设默认业务类型。
- 归属：规则表按优先级匹配（条件为业务类型、目录类型或任一单选字段的值），得出归属主体（可空）与通知收件人；未命中用默认规则。
- 邮件：入库后发给收件人，含字段内容、来源页面与后台链接；只发不收，用站点设置中的 SMTP，失败重试并记日志。
- Webhook：`inquiry.created` 推送到一个或多个地址；通用 JSON 模板按第 6 章方式签名（时间戳 + 投递 ID），飞书、钉钉模板按各自机器人的加签规则，企业微信与 Slack 模板以 Webhook 地址中的密钥鉴权。
- 防护：schema 校验（422）、表单 Key、限速（429）、蜜罐字段、可选 Cloudflare Turnstile。
- 归因：UTM 五参数（首次触点）、广告点击 ID（`gclid` / `gbraid` / `wbraid` / `fbclid` / `ttclid` / `msclkid`，最近一次）、首次着陆页与来源域名。
- 即时通讯在 `site` 模块配置（关闭询盘不受影响）：渠道（如 WhatsApp）、号码与各语言预填文案经 `/site` 下发；点击不入库、不发邮件。
- 询盘永久保存，可导出 CSV，支持按请求删除单条（个人数据）。

**追踪**（`tracking`，仅管理员，与询盘相互独立）

- 配置前台 GTM 容器 ID、自定义 head / body 代码、转化事件开关（事件列表随已启用模块）、前台 CSP 放行域名；经 `/site` 下发、只由前台输出，管理界面不加载任何追踪代码。
- 自定义代码与已填容器 ID 重复时保存提示；站点验证标签在 SEO 模块。
- 事件命名、dataLayer 格式与 GTM 容器属于前台实现。

## 9. 部署、安全与运维

**容器与数据**

| 容器 | 说明 |
| --- | --- |
| `cms` | SvelteKit（adapter-node）：管理界面 + 全部 API + 后台任务（pg-boss 队列：图片变体、R2 同步与回填、邮件、Webhook、AI、指标拉取、定时发布、备份）；端口默认绑定 `127.0.0.1:3001` |
| `postgres` | PostgreSQL 16+，仅内网 |

**接口与后台任务**：代码层隔离、部署层合一。任务处理位于 `packages/jobs`，只经队列调用，不依赖请求上下文；启动入口按环境变量 `BLUEPAX_ROLES`（默认 `web,worker`）决定本进程启动哪些角色。部署时一个镜像、一个容器、同一生命周期；sharp 图片处理在 libuv 线程池中执行，不阻塞接口，任务并发可配置（图片处理默认 2）。负载变大时可用同一镜像另起一个 `BLUEPAX_ROLES=worker` 的容器，不改代码。

- 卷：`pgdata`、`uploads`（本地存储根目录）、`backups`。镜像 `ghcr.io/bluepax/bluepax-cms`，提供 `docker-compose.yml` 与 `.env.example`。
- 启动顺序：先取得 PostgreSQL advisory lock，再检查待执行的迁移；有则先做一次数据库全量备份、再执行迁移；释放锁后启动接口与后台任务。任一步失败则容器退出、不对外服务。迁移只向前，降级通过恢复升级前的备份完成。未初始化时任何请求都跳转初始化向导。
- 密钥只放环境变量：`DATABASE_URL`、`APP_SECRET`（会话与签名）、`ENCRYPTION_KEY`（加密存储的第三方凭据、SMTP 密码、R2 密钥、AI Key）。

**技术栈**

| 层 | 选型 |
| --- | --- |
| 应用 | SvelteKit + Svelte 5 Runes + TypeScript + Vite |
| 管理界面 | shadcn-svelte + Tailwind CSS，Paraglide（zh / en） |
| 数据 | PostgreSQL + Drizzle ORM，Zod 校验并导出 JSON Schema |
| 队列 | pg-boss（不引入 Redis / Valkey） |
| 富文本 | Tiptap，存 JSON |
| 图片 | sharp |
| 测试 | Vitest、OpenAPI 契约测试、Playwright |
| 包管理 | pnpm workspace |

**网关要求**（仓库提供 OpenResty / Caddy / Cloudflare 示例）

- HTTPS 终止在网关；真实 IP 取 `CF-Connecting-IP` 或 `X-Forwarded-For`（只信任配置的代理）。
- 管理界面可加 Cloudflare Access 或 IP 白名单，但 `/api/*` 与媒体路径不在其内。
- CMS 域名整体 `noindex`，包括媒体文件（见第 5 章“缓存与收录”）；不要在网关拦截 AI 爬虫（由前台站点自行决定）。

**安全**

- 账号安全见第 3 章“通用能力”；会话存库，可在“用户”中查看并强制下线。
- 会话 Cookie `HttpOnly`、`Secure`、`SameSite=Lax`；管理写操作带 CSRF 校验。
- 安全响应头：CSP、HSTS、`X-Content-Type-Options`、`Referrer-Policy`、`frame-ancestors 'none'`。
- 上传按内容嗅探类型，SVG 净化；Token 只存哈希，可设过期与权限范围。
- 审计日志记录登录、权限、设置、发布、删除、Token 与存储切换。

**备份与可观测**

- 每日 `pg_dump` 数据库全量备份，保留最近 7 天的每日备份，另保留最近 4 周每周日的那份（最多共 11 份）；可选加密后同步到独立的私有 R2 桶（不与媒体桶共用）。媒体文件不备份：需要冗余时接入 R2 镜像（第 5 章），仅本地存储时磁盘损坏会丢失媒体。
- 后台可下载备份、查看最近结果；文档提供恢复步骤，发版前做恢复演练。
- 结构化 JSON 日志带请求 ID；健康检查端点见第 6 章，容器 healthcheck 使用 `GET /api/health`。

## 10. 开源仓库（MIT）

| 项 | 值 |
| --- | --- |
| 仓库 | `git@github.com:bluepax/bluepax-cms.git`（https://github.com/bluepax/bluepax-cms） |
| 许可 | MIT，`Copyright (c) 2026 BluePax` |
| 镜像 | `ghcr.io/bluepax/bluepax-cms` |
| npm | `@bluepax/cms-client`、`@bluepax/cms-blocks` 发布到 GitHub Packages（`publishConfig.registry: https://npm.pkg.github.com`；`repository` 指向本仓库，首次发布即自动关联；可见性 Public）；其余 workspace 包一律 `"private": true` |
| 文档语言 | 代码、注释、提交与 Issue 用英文；README 提供英文与简体中文 |

**目录**

```
bluepax-cms/
├─ apps/cms/               # SvelteKit 应用（管理界面 + API + 启动入口，按 BLUEPAX_ROLES 启动角色）
├─ packages/
│  ├─ core/                # 实体、模块注册、权限、事件（private）
│  ├─ db/                  # Drizzle schema、迁移（private）
│  ├─ jobs/                # 后台任务处理（private）
│  ├─ presets/             # 企业 / 博客预设与通用种子（private）
│  ├─ storage/             # StorageDriver：local、r2（private）
│  ├─ cms-blocks/          # 区块 schema，发布为 @bluepax/cms-blocks
│  └─ cms-client/          # 类型化 SDK，发布为 @bluepax/cms-client
├─ examples/
│  ├─ minimal-site/        # 最小 SvelteKit 前台
│  └─ config/              # corporate.yaml、blog.yaml
├─ deploy/                 # docker-compose、.env.example、网关示例
├─ docs/                   # 使用文档；docs/spec/（本规范）、docs/adr/（架构决策）
└─ .github/
```

**仓库文件清单**

- `README.md` / `README.zh-CN.md`：定位、截图、快速开始（compose 一条命令起实例）、前台接入链接。
- `LICENSE`（MIT）、`THIRD_PARTY_NOTICES.md`（CI 生成）。
- `CONTRIBUTING.md`：开发环境、分支与提交规范（第 11 节）、DCO 签名（`git commit -s`）。
- `CODE_OF_CONDUCT.md`（Contributor Covenant 2.1）、`SECURITY.md`（私下报告渠道：GitHub Security Advisories）。
- `CHANGELOG.md`（git-cliff 生成，`cliff.toml`）。
- `.github/`：Issue 模板（bug / feature）、PR 模板、`CODEOWNERS`、`dependabot.yml`、`workflows/ci.yml`（lint、类型检查、单元与契约测试、E2E、许可证检查）、`release.yml`（标签触发：完整构建与检查、推送镜像、发布 npm 包到 GitHub Packages、创建带版本说明的 GitHub Release，见第 11 章）、`codeql.yml`。
- 工程配置：`.editorconfig`、`.gitignore`、`.nvmrc`、`pnpm-workspace.yaml`、ESLint / Prettier、commitlint、`.dockerignore`。

**约定**

- 不含任何遥测；不提交真实站点数据、域名、品牌素材，示例一律用虚构站点。
- 开启 secret scanning 与 push protection；依赖只允许宽松许可（MIT、BSD、ISC、Apache-2.0 等），CI 拦截 GPL / AGPL / LGPL。唯一例外是 sharp 依赖的 libvips 预编译包（`@img/sharp-libvips-*`，LGPL-3.0）：以动态链接方式使用，列入许可白名单，许可证文本随镜像与 `THIRD_PARTY_NOTICES.md` 一并提供。
- 各自的前台代码与生产部署配置放在各自的私有仓库，只以镜像版本号引用本项目。

## 11. 版本与分支管理（BluePax Flow）

采用 BluePax Flow 第三版：在第二版基础上按 GitHub 开源协作与 npm / Docker 发布做了调整，调整处在本节末尾列出，Flow 原文已同步更新。

**版本号**

- SemVer 2.0，起始版本 `1.0.0-beta.1`；`beta` 是唯一预发布标识。
- 预发布只用于新主版本：`X.0.0-beta.N`（N 为 build 号），之后发布正式版 `X.0.0`；次版本与修订版（如 `X.1.0`、`X.0.1`）不设 beta，直接发布正式版。例：`2.0.0-beta.512` → `2.0.0` → `2.0.1` → `2.1.0`。
- 版本代号取天空中的生物，用一个英文小写单词（如 `swift`、`kestrel`、`albatross`）；同一主版本 X 的全部版本（含 beta）共用一个代号，新主版本换新代号，代号不重复使用。
- build 号 = dev 分支上的提交序号（`git rev-list --count --first-parent <dev 提交>`），从 1 开始递增：dev 第一父链上的每个提交计一个 build（PR 的合并提交、所有者本地合并的提交或所有者的直接提交），功能分支内部的提交不计入；每个发布版本对应唯一 build 号。CI 检出完整历史（`fetch-depth: 0`）后计算；在 main 上构建时，取发布提交的第二父提交（即合入的 dev 提交）计数。
- 版本号、build 号、构建时间、提交 SHA 在构建时注入，显示在后台「关于」页并由 `GET /api/health` 返回。
- 升级规则：含破坏性变更（`!` 或 `BREAKING CHANGE:`）升主版本，含 `feat` 升次版本，其余升修订号。Delivery API 与 SDK 的破坏性变更只在主版本发生。
- 镜像标签：正式版 `X.Y.Z`、`X.Y`、`X`、`latest`；新主版本的 beta 为 `X.0.0-beta.N` 与 `beta`；dev 每次合入发布 `edge`。npm 包版本号与 CMS 一致，dist-tag 为 `latest` 与 `beta`。

**分支**

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 只用于发布 | 不直接提交；每个提交都是从 dev 合入的发布提交，并带附注标签 `vX.Y.Z` 或 `vX.0.0-beta.N`，标签注释用英文，格式为「版本代号; 说明」，如 `swift; first flight` |
| `dev` | 开发与热修复 | 默认分支；第一次提交为 `init: init the project and add basic files`；合入的内容必须完整、随时可发布；热修复也合入 dev，即使 dev 已含未发布内容；其他人只能经 PR 合入，所有者可直接 push |
| `feature/xxx`、`fix/xxx` | 功能开发与修复 | 从 dev 拉出，按主要功能命名；合入前必须先合入最新 dev 并通过 CI；外部贡献者在 fork 中创建同名分支；所有者的分支在本地用 `git merge --no-ff` 合入 dev 后直接 push，不开 PR |

**角色**（对应原「成员 / 组长 / 项目主管部」）

- Contributor：在 fork 或自己的分支提交，向 dev 发起 PR。
- Maintainer：有协作者后由 `CODEOWNERS` 指定负责的模块或目录，审核相关 PR；目前不设。
- 所有者：组织 Owner 的个人账号（SSH key 推送），管理 dev 与 main，合并 PR、热修复、发布版本；自己的改动直接操作仓库、不走 PR（在仓库规则集中列为绕过者）；`CODEOWNERS` 默认 `* @<所有者用户名>`。不另建团队，协作者增多后再建团队替换。

**提交信息**

```
<类型>[(范围)][!]: <描述> [#issue]

[可选正文]
```

- 类型：`feat` 新功能，`fix` 修复，`perf` 性能，`refactor` 重构，`docs` 文档，`test` 测试，`build` 项目结构、依赖与配置，`ci` 持续集成，`revert` 回退，`chore` 其他（必须写清改动）；`init` 只用于第一次提交。
- 范围取模块 ID 或包名，如 `feat(storage): add R2 backfill #42`；描述用英文祈使句。
- 合入 dev 只用合并提交（GitHub 的 Create a merge commit，等同 `--no-ff`），仓库关闭 squash 与 rebase 合并，保留完整提交历史；所有者在本地合并同样用 `git merge --no-ff`。每个提交都须符合规范：PR 中的提交由 CI 的 commitlint 逐个校验；所有者直接 push 时，本地 commit-msg 钩子先校验，push 到 dev 后 CI 再校验本次推送的全部提交；合并提交保留默认信息 `Merge pull request #N from …`，git-cliff 生成变更列表时跳过合并提交。

**发布流程**（所有者执行）

1. 所有者在 dev 上直接提交 `chore(release): vX.Y.Z[-beta.N]`（不开 PR），只包含 git-cliff 生成的 `CHANGELOG.md` 更新；beta 的 N 就是这次提交后的 build 号（当前 build 号 + 1）。push 后等 dev 的 CI 全部通过再进入下一步；main 上不修改任何文件。
2. 在 main 上执行 `git merge --no-ff --no-commit dev`，检查无误后提交，提交信息为：

```
<版本代号>(vX.Y.Z[-beta.N]): <新版本简述>

<feature>
Add ... #45
<bug>
Fix ... #121
```

3. 打附注标签 `git tag -a vX.Y.Z -m "<codename>; <description>"`（说明用英文）并推送。
4. 标签触发 `release.yml`：先完整构建整个项目并跑完 CI 全部检查，再构建并推送镜像到 GHCR、发布 `@bluepax/cms-client` 与 `@bluepax/cms-blocks` 到 GitHub Packages（正式版 dist-tag `latest`，beta 为 `beta`）、最后创建 GitHub Release（正文见下；beta 标为 Pre-release，正式版标为 Latest）。各包 `package.json` 在仓库中保持版本 `0.0.0-development`，由 `release.yml` 按标签写入版本号后再构建与发布。npm 包、镜像与 Release 都只用 Actions 自带的 `GITHUB_TOKEN`（npm 包需 `packages: write`），仓库中不保存任何个人 Token；GitHub Packages 不支持 npm provenance，改为对发布的 npm tarball 生成 GitHub 构建来源证明（artifact attestation，需 `id-token: write` 与 `attestations: write`）。
   - Release 正文由 workflow 自动生成，依次为：
     1. 版本：`vX.Y.Z`、代号、build 号、提交 SHA。
     2. 镜像：`ghcr.io/bluepax/bluepax-cms:X.Y.Z` 及本次一并更新的标签（`X.Y`、`X`、`latest`；beta 为 `beta`），附镜像 digest。
     3. npm：`@bluepax/cms-client@X.Y.Z` 与 `@bluepax/cms-blocks@X.Y.Z` 及 dist-tag，附 GitHub Packages 页面链接；两个包每次都随 CMS 同步发版。
     4. 变更列表：git-cliff 生成与上一个标签之间的变更，按提交范围分为“CMS 与镜像”“npm：cms-client”“npm：cms-blocks”三组，破坏性变更置顶；某个包本次无变更时写“无变更，仅同步版本号”。
   - 失败处理：任一步失败都不创建 Release；修复后对同一标签重跑 workflow，已发布的 npm 版本自动跳过，镜像重新推送并覆盖同名标签。

**保护规则**

- main 与 dev 开启分支保护：禁止 force push 与删除，禁止改写历史（不使用 `reset`、不对共享分支 rebase）。
- dev：用仓库规则集保护，其他人只能经 PR 合入（CI 通过、分支已包含最新 dev）；所有者列为绕过者，可直接 push。直接 push 没有 CI 预检，push 前由本地 pre-push 钩子跑 lint、类型检查与单元测试；push 后 CI 照常运行，未通过的提交不得发布。单人维护期间必需批准数设为 0（GitHub 不允许批准自己的 PR），有协作者后改为 1 并要求 CODEOWNERS 审核。main：只有所有者可推送。
- push 前先 pull；只对自己负责的部分 push 和发起 PR。

**相对原版的调整**

| 原版 | 本项目 | 原因 |
| --- | --- | --- |
| `X.Y.Z-beta+build.N` | `X.Y.Z-beta.N` | SemVer 比较会忽略 `+` 后的元数据，Docker 标签不允许 `+`；放入预发布段后可排序、可对应镜像标签 |
| x.0.0 必为 beta，x.0.1 为首个正式版 | `X.0.0-beta.N` 之后的 `X.0.0` 即正式版；只有 X.0.0 有 beta | 按 SemVer，`X.0.0` 已高于其全部 beta，不必再用 `X.0.1` 区分；次版本与修订版直接发正式版 |
| GitLab 成员 / 组长 / 项目主管部 | Contributor / Maintainer / 所有者账号 | GitHub 的 fork + PR + CODEOWNERS 模型 |
| `structure`、`null` | `build`、`chore`，新增 `ci` | 与 Conventional Commits 工具链（commitlint、git-cliff）兼容 |
| 热修复直接提交 dev | 所有者可直接提交 dev（含热修复）；其他人的修改走 PR | 所有者有绕过权限；直接 push 同样触发 CI，未通过的 build 不发布 |

## 12. 验收标准

**初始化与配置**

- [ ] 空库启动 → 初始化向导；分别选择企业与博客，得到各自的模块、区块与种子；同一份 YAML 可无交互重复初始化。
- [ ] 后台导出的实例配置可在空库上无交互初始化，得到相同的模块、语言、路由模板、目录、字段与字典。
- [ ] 关闭可选模块后：菜单、权限点、API（404）、`/site` 字段、依赖它的区块均不可用；重新开启后数据仍在。
- [ ] 目录类型、业务类型、询盘字段全部在后台配置，代码中没有任何具体站点的枚举值。
- [ ] 编辑账号无法访问追踪、存储、Token、用户、站点级设置以及 robots 与站点验证标签（UI 与 API 均拒绝）。

**内容与接口**

- [ ] 发布、下线、改 slug、删除、替换媒体均触发对应 Webhook；签名、时间戳与投递 ID 可验证，过期与重复投递被识别；失败按策略重试并可手动重发。
- [ ] 改 slug、品类或路由模板自动生成 301，条链被折叠、环路被拒绝；永久删除的内容返回 410。
- [ ] 编辑已发布内容并保存后线上不变，发布后才生效；回滚只写入工作副本。
- [ ] 某语言未发布时该语言地址返回 404、不回退；`seo.hreflang` 只列出已发布语言。
- [ ] OpenAPI 文档与实际响应一致（契约测试）；`@bluepax/cms-client` 类型与文档同源生成。
- [ ] 错误响应使用语义化状态码（400 / 401 / 403 / 404 / 409 / 410 / 422 / 429）与统一错误体。
- [ ] 搜索对大小写、重音符号、阿拉伯文变体做归一化；草稿不可搜。
- [ ] 未设 OG 图时按封面或首图 → 站点默认分享图回退。

**媒体与存储**

- [ ] 仅本地存储时上传、变体、删除均正常。
- [ ] 添加 R2 后：新上传同时写入两端；历史文件可回填并显示进度；回填未完成不允许切换到 R2。
- [ ] 切换分发源后触发 `media.origin_changed`；未同步的单个对象回退本地 URL。
- [ ] 前台来源检查能判断前台页面引用的是 R2 还是本地，并列出不一致的地址。
- [ ] 断开 R2 时上传仍成功（本地为准），同步进入重试。
- [ ] 替换媒体后旧对象在本地与 R2 被删除，并触发 `media.replaced`。
- [ ] 媒体响应带后台设置的缓存时长与 `X-Robots-Tag: noindex`。

**询盘**（模块开启时）

- [ ] 自定义字段的显示、必填与校验前后端一致；错误按字段返回 422。
- [ ] 归属规则按优先级命中，邮件与 Webhook 发给正确对象；超限返回 429，限速按访客 IP 计算，不按前台服务器 IP。
- [ ] UTM 与点击 ID 被记录；导出 CSV 包含自定义字段。

**运维与开源**

- [ ] `docker compose up` 从零起实例；升级镜像时有待执行迁移则先备份再迁移，数据完整；迁移失败时容器不对外服务。
- [ ] 数据库备份可在全新环境中恢复并正常运行（媒体从 R2 或原 `uploads` 卷恢复）。
- [ ] `GET /api/health` 与「关于」页显示版本号、build 号、构建时间与提交 SHA。
- [ ] 推送标签后自动发布镜像、npm 包与 GitHub Release，Release 正文列出版本与 build 号、镜像标签与 digest、两个 npm 包的版本及分组变更列表；CI 包含 lint、类型、单元、契约、E2E、许可证与 CodeQL。
- [ ] `examples/minimal-site` 只依赖公开 SDK 即可渲染首页、文章页与 404。

## 13. v1 范围、默认值与待定事项

**实现顺序**（M1–M4 每个里程碑结束都可发一个 1.0.0 的 beta；1.1、1.2 是次版本，不设 beta）

| 里程碑 | 内容 |
| --- | --- |
| M1 骨架 | 仓库与 CI、模块注册、初始化向导与预设、users、site、media（仅本地）、pages、posts、路由模板、Delivery / Preview API、最小示例前台 |
| M2 发布链路 | seo（301、sitemap 数据、404 日志）、Webhook、工作副本、版本与回滚、定时发布、搜索、备份 |
| M3 存储 | R2 驱动、镜像与回填、分发源切换、前台源站检查 |
| M4 企业模块 | catalog、inquiries（含字段、归属、邮件、Webhook 模板）、regions、tracking；完成第 12 章全部验收后发 `1.0.0` |
| 1.1 看板 | `insights`：SEO / GEO 看板、AI 爬虫统计、引用监测（含监测引擎）；直接发 `1.1.0` |
| 1.2 AI | `ai`：AI 写作与翻译、AI 供应商与用量上限；直接发 `1.2.0` |

1.1、1.2 不发 beta，所以功能在 feature 分支开发完成并通过验收后才合入 dev；两个模块的验收项在各自发布前补进第 12 章。已有实例升级到 1.1 或 1.2 时，新模块默认关闭，由管理员开启；之后新初始化的实例按第 2 章的预设开启。看板里的“一键转 AI 选题”只在 `ai` 启用后出现。

**v1 不做**：评论、邮件订阅、会员与公开注册、多租户、GraphQL、自由拖拽式页面搭建与自定义 HTML 区块、价格与电商、询盘附件、广告平台离线转化回传、WordPress 等外部导入、告警推送、插件市场（模块只在仓库内添加）。

**默认值**（均可在实例配置中修改）

| 项 | 默认 |
| --- | --- |
| 上传上限 | 图片 20 MB、PDF 与文档 50 MB、视频 200 MB |
| 媒体缓存 | 365 天（存储设置中按天修改） |
| 会话 | 7 天滑动过期；改密码或停用账号时全部失效 |
| 登录锁定 | 同一账号 15 分钟内失败 5 次锁定 15 分钟 |
| 预览链接 | 1 小时有效 |
| 版本历史 | 每条内容每种语言保留最近 50 个版本 |
| Webhook | 超时 10 秒，指数退避最多 8 次，投递记录保留 30 天；接收端时间戳容差 5 分钟，投递 ID 去重 24 小时 |
| 日志保留 | 404 日志 90 天、审计日志 365 天、邮件通知记录 90 天 |
| 备份 | 每天 03:00（站点时区）备份一次；保留最近 7 天的每日备份，另保留最近 4 周每周日的那份，最多共 11 份 |
| 限速 | Delivery Token 1200 次 / 分钟；询盘每 IP 5 次 / 10 分钟；登录每 IP 20 次 / 10 分钟 |
| AI | 未设月度费用上限时不允许调用；引用监测每周一次 |

**开工清单**

- [ ] 第一次提交 `init: init the project and add basic files`，从该提交创建 `main`，仓库默认分支设为 `dev`。
- [ ] 按第 11 章配置 main / dev 分支保护（dev 用规则集，并把所有者账号加入绕过名单）；仓库合并方式只保留 Create a merge commit，关闭 squash 与 rebase，不开启“要求线性历史”。
- [ ] 首次发布后在组织 `bluepax` 的 Packages 中把 `@bluepax/cms-client`、`@bluepax/cms-blocks` 设为 Public（GitHub Packages 新包默认 Private），并确认已关联本仓库；需要在 Actions 中安装这两个包的前台仓库，在包设置里授予其读取权限。
- [ ] 首次发布后把 GHCR 镜像 `ghcr.io/bluepax/bluepax-cms` 设为 Public 并关联仓库。
- [ ] 按第 11 章规则选定 1.x 的代号，用于 `1.0.0-beta.N` 与之后的全部 1.x 版本。
