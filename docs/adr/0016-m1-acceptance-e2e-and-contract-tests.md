# 0016 M1 验收：按里程碑划分验收项、契约测试、E2E 测试与仓库历史

- 状态：已采纳（2026-11-27）
- 涉及：规范第 9 章（技术栈中的测试）、第 10 章（`ci.yml` 的检查项、目录）、第 11 章（main 与 dev 的第一个提交）、
  第 12 章（验收标准）、第 13 章（里程碑、开工清单），`docs/acceptance/`、`e2e/`、`playwright.config.ts`、
  `.github/workflows/ci.yml`、`apps/cms/src/lib/server/delivery/delivery.test.ts`、
  `apps/cms/src/lib/server/testing.ts`

## 背景

规范第 12 章的验收标准对应 `1.0.0`：第 13 章写明 M4 完成第 12 章全部验收后才发 `1.0.0`，而 M1–M4 每个里程碑结束都可以
发一个 `1.0.0` 的 beta。规范没有说明 beta 前怎样验收、验收结果记在哪里，也没有说明一条验收项只有一部分功能已经存在时
怎么处理（例如“编辑账号无法访问追踪、存储、Token、用户、站点级设置以及 robots 与站点验证标签”，其中追踪属于 M4，
robots 与站点验证标签属于 M2）。

M1 验收时还发现两处与规范不一致：

- 第 10、12 章要求 CI 包含契约测试与 E2E 测试。契约测试按 ADR 0012 的解释由集成测试承担：用生成 OpenAPI 的同一组
  Zod schema 解析真实响应。但 Zod 对象解析时会丢掉未知字段，响应里多出文档没写的字段时测试照样通过，“文档与实际响应
  一致”只验证了一半。E2E 测试完全没有：第 9 章技术栈列了 Playwright，仓库里却没有。
- 第 11 章与第 13 章开工清单要求 dev 的第一个提交是 `init: init the project and add basic files`，并从该提交创建 main；
  main 上每个提交都是带标签的发布提交。仓库实际的第一个提交是 2026-11-21 在 GitHub 网页上创建的
  `a9edb1f Create FUNDING.yml`，`init` 提交 `38ab305` 是它的子提交，`main` 指向 `a9edb1f`。

## 决策

### 验收按里程碑划分，结果写进验收记录

- 每个里程碑的 beta 发布前做一次验收，记录放在 `docs/acceptance/<里程碑>.md`（M1 为 `docs/acceptance/m1.md`）：
  第 12 章的每一条都列出属于哪个里程碑（依据第 13 章里程碑表）、结果（通过 / 不通过 / 延后）与证据（测试文件、命令、
  浏览器检查）。
- 一条验收项跨越多个里程碑时拆开写：现在已有的部分在本次验收中检查，其余部分注明在哪个里程碑验收。
- 里程碑范围内不通过的条目在 beta 前修复；属于后续里程碑的条目在那个里程碑的验收记录里再检查一次。

### 契约测试：解析结果必须等于原始响应

- 保留 ADR 0012 / 0013 的做法（契约 schema 在 `@bluepax/cms-client/contract`，OpenAPI 文档与 SDK 类型都由它生成），
  并在 `delivery.test.ts` 中加一步：每个响应用契约 schema 解析后，解析结果必须与原始响应完全相等（`described()`）。
  这样既检查了文档写到的字段类型与必填，也保证响应里没有文档没写的字段。错误响应与预览响应同样检查。
- 没有改用 JSON Schema 校验器去对照 `/openapi.json`：那要多一个依赖，而 OpenAPI 文档本来就由同一组 schema 用
  `z.toJSONSchema` 生成；SDK 与 CMS 操作表的对应关系由 `client.test.ts` 检查。
- 契约测试仍在 CI 的 `test` 任务里运行（需要 PostgreSQL），不单设任务。

### E2E 测试：Playwright 驱动生产构建

- 根目录 `e2e/` 与 `playwright.config.ts`，开发依赖 `@playwright/test`（1.65.1，Apache-2.0，按 ADR 0004 取发布满一天的
  版本），只用 Chromium。E2E 同时覆盖 CMS 与示例前台，所以放在根目录而不是某个 workspace 包里；第 10 章的目录树只列
  主要目录，这里记录这一补充。
- 测试对象是生产构建（`apps/cms/build`、`examples/minimal-site/build`），先 `pnpm build`。`e2e/serve.ts` 在
  `TEST_DATABASE_URL` 旁边新建空库 `<库名>_e2e`，使用临时的上传与备份目录和一次性密钥，所以每次都从初始化向导开始。
- M1 覆盖的流程（`e2e/m1.spec.ts`，按顺序在一个 worker 中运行，后一个依赖前一个的结果）：空库跳转向导、Delivery
  返回 503；向导按博客预设初始化（模块、区块、默认分类，经导出的实例配置核对）并关闭；管理员创建编辑账号；编辑看不到
  设置、接入与 API、用户菜单，访问这些页面、配置下载与表单动作都得到 403（表单动作带同源 `Origin`，只由权限检查拒绝）；
  编辑建首页（Hero 区块）并发布、建文章并发布；管理员签发 Delivery Token，接口返回站点、路径解析（301 / 200 / 404）、
  未发布语言 404、`hreflang` 只含已发布语言；示例前台用这个 Token 渲染首页、文章页、canonical 与 404。
- CI 新增 `e2e` 任务（PostgreSQL 服务 + `playwright install --with-deps chromium` + `pnpm build` + `pnpm e2e`），失败时上传
  `test-results/`（含 trace，保留 7 天）；`edge` 镜像等它通过后才发布；`release.yml` 调用整个 `ci.yml`，发版前同样运行。
  pre-push 钩子不跑 E2E（需要浏览器且耗时），由 CI 把关。
- 后续里程碑把各自的关键流程加进 E2E（如 M2 的工作副本与 Webhook、M4 的询盘表单）。

### 权限测试使用初始化写入的编辑角色

- 新增 `#lib/server/testing.ts` 的 `defaultEditor()`：权限点取 `registry.editorPermissions(全部已注册模块)`，与初始化
  种子完全相同。设置、接入与 API、存储设置、用户管理的权限测试与菜单测试都用它，而不是手写的权限子集——以后模块
  新增内容权限点时，这些测试自动按真实编辑角色检查。

### 仓库历史：保留 `Create FUNDING.yml` 在 `init` 之前

- 第 11 章禁止改写共享分支的历史（不 force push、不 rebase），所以不改写 dev 与 main 去满足“第一个提交是 init”。
  `a9edb1f` 是唯一不符合 BluePax Flow 提交格式、也唯一没有标签的 main 提交，记为历史例外。
- 影响已核对：首个发布提交在 main 上是 `git merge --no-ff dev`，第一父提交为 `a9edb1f`、第二父提交为 dev，
  `scripts/release/info.ts` 只检查标签指向的提交；git-cliff 配置了 `filter_unconventional`，变更列表不会收入
  `Create FUNDING.yml`；commitlint 只校验推送与 PR 范围内的提交，不会回头检查它。

## 影响

- CI 多一个约 3–4 分钟的 `e2e` 任务（与其他检查并行）。贡献者本地运行 E2E 前需执行一次
  `pnpm exec playwright install chromium`（见 CONTRIBUTING.md）。
- 契约测试对“多出的字段”也会失败：给 Delivery 响应加字段时必须先改 `packages/cms-client/src/contract.ts`（v1 只增
  不删，第 6 章）。
- 每个里程碑的 beta 前都要更新或新增一份验收记录。
