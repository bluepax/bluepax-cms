# 0019 后台任务（`packages/jobs` 与 pg-boss）与每日备份

- 状态：已采纳（2026-11-28）
- 涉及：规范（主本 rev 190）第 2 章（实例配置项）、第 3 章（`site` 模块、权限点）、第 4 章（核心表、任务队列表）、第 6 章（健康检查：
  worker 心跳、备份）、第 9 章（容器与数据、接口与后台任务、启动顺序、备份与可观测）、第 12 章“运维与开源”、
  第 13 章（M2 的“备份”，默认值“备份”），`packages/jobs`、`packages/db`（`backup_runs`、`afterMigrate`、可中止的
  `pg_dump`）、`packages/presets`（`backups` 一节）、`apps/cms/src/lib/server/{runtime,worker,backups}.ts`、
  “设置 → 备份”、`deploy/`

## 背景

ADR 0015 把 `packages/jobs`、pg-boss 与每日备份留给 M2 的第一个后台任务（[0018](0018-m2-order.md) 的第 1 项）。规范
写了：任务处理放在 `packages/jobs`，只经队列调用、不依赖请求上下文；`BLUEPAX_ROLES`（默认 `web,worker`）决定进程
启动哪些角色；队列用 pg-boss；每天 03:00（站点时区）备份，保留最近 7 天的每日备份另加最近 4 周每周日的那份，最多
11 份；后台可下载备份、查看最近结果；`system/status` 要看 worker 心跳与备份。没有写的有：pg-boss 何时建表、心跳
记在哪、失败怎么重试、进程怎么停、“4 周每周日”与“最多 11 份”怎样同时成立、备份设置放在哪、谁能下载。

## 决策

### 队列与 worker

- **pg-boss 12.39.0**（MIT；依赖 cron-parser、rrule-temporal、serialize-error 均为 MIT；可选同伴依赖
  `@opentelemetry/api` 为 Apache-2.0）。按 ADR 0004 选了发布满一周、没有安全公告的版本（最新的 12.40.0 只发布了 3 天）。
  表放在数据库 schema `pgboss`（第 4 章“任务队列表”），由 pg-boss 自己的迁移维护，不进 Drizzle 迁移集。
- **`packages/jobs`**（私有包）：`Jobs` 封装一个 pg-boss 实例（自带连接池，默认 4 个连接，`application_name`
  `bluepax-jobs`）；`queues.ts` 定义每个队列的数据类型、重试与保留；任务处理函数（如 `runBackup`）也在这里，只接收
  任务和 worker 交给它的服务（数据库、备份目录、设置读取函数、日志），从不接触请求。应用侧的
  `apps/cms/src/lib/server/worker.ts` 只负责把这些服务交给处理函数。
- **角色。** 每个进程都创建 `Jobs`，都能发送任务、写定时计划（“立即备份”、保存备份时间都在 web 进程里发生）；只有
  `worker` 角色的进程开启 pg-boss 的维护（`supervise`）与定时计划（`schedule`）并领取任务（`work`），只有 web 角色的
  进程领取任务会直接报错。
- **启动顺序（先迁移，再启动 worker）。** `runMigrations` 新增 `afterMigrate` 回调：在持有迁移锁的同时、所有迁移
  完成之后调用（没有待执行迁移时也调用），启动时在这里执行 `jobs.start()`——安装或升级 pg-boss 的 schema 并创建或
  更新队列。于是任何时候只有一个进程在改 pg-boss 的表，而且总在应用的迁移之后，符合 ADR 0015 的安排。随后释放锁、
  按配置文件初始化，最后才在 worker 角色中注册处理函数。pg-boss 自身 schema 的升级不触发迁移前备份：队列里只有
  临时数据，而失败同样会让启动失败、不对外服务。
- **心跳。** 用 pg-boss 12 的实例登记（instance registry）：每个进程以 `BLUEPAX_ROLES`（如 `web,worker`）为名
  登记，每 30 秒刷新心跳，记录主机、pid、所领取的队列、进程指标与异常退出次数；三个心跳周期没有消息即视为离线，
  正常停止会写入停止时间。`Jobs.instances()` 读出这些记录。“设置 → 备份”显示正在领取 `backup` 队列的 worker 与
  最近心跳；M2 第 7 项的 `system/status` 直接用它，不另建表。
- **重试。** 处理函数抛错即本次尝试失败，pg-boss 按队列设置重试：备份 `retryLimit` 2、`retryDelay` 300 秒、
  指数退避（`retryBackoff`，上限 1 小时）、单次最长 4 小时（`expireInSeconds`，超时后 `job.signal` 中止，pg_dump 随之
  停止）。管理员点“立即备份”发出的任务不重试（`retryLimit` 0）：结果直接显示，管理员可以再点。
- **同一时间只排一个。** `backup` 队列用 `exclusive` 策略、以备份类型为单例键：同一类型的备份同时最多一个在排队或
  执行，重复点击“立即备份”或上一次每日备份尚未结束时都不会再加一个。
- **优雅停止。** 生产环境收到 SIGTERM / SIGINT 时，worker 立即停止领取新任务，并给正在执行的任务 20 秒，与
  adapter-node 关闭 HTTP 连接（最多 30 秒）同时进行；仍未结束的任务被中止并标记失败，之后按重试规则重来。两者都
  结束后关闭连接池。compose 的 `stop_grace_period` 为 40 秒，留够余量。`vite dev` 由 Vite 自己处理信号。

### 每日备份

- **时间。** 定时计划写在 pg-boss 的 `schedule` 表中：cron `M H * * *`，时区取站点设置的 `site.timezone`（实例
  唯一的时区设置，规范第 13 章所说的“站点时区”即它）。`missed: 'once'`：03:00 时没有 worker 在运行（停机、升级），
  worker 恢复后补做一次。worker 启动时以及之后每分钟按当前设置核对一次计划（改时区、刚完成初始化、导入配置都会
  自动跟上），保存备份设置时立即更新。未初始化的实例不排计划。
- **文件。** 写在 `BLUEPAX_BACKUPS_DIR`（镜像中为 `backups` 卷）：`daily-YYYYMMDD-HHMMSSZ.dump`、
  `manual-…`、`pre-migrate-…`（时间为 UTC），格式与迁移前备份相同（`pg_dump --format=custom`，先写 `.partial`
  再改名）。文件名本身说明类型与时间，目录不需要另外的索引；下载、删除只接受符合这个格式的名称，从不接受路径。
  被强制结束的进程留下的 `.partial` 文件在 4 小时后由下一次备份清除。
- **保留规则（“最多共 11 份”）。** 只针对每日备份，每次每日备份成功之后执行：同一天（站点时区）有多份时只算最新的
  一份；保留最近 7 个有备份的日子；在这 7 份之前，再保留最近 4 个周日的备份；其余每日备份删除。7 天的窗口里本身
  总含一个周日，若把它也算进“4 周每周日”，总数最多只有 10 份；规范写“最多共 11 份”，所以 4 份周日备份是 7 份之外的、
  更早的 4 个周日。按“有备份的日子”而不是日历天数计算，漏备的日子不会让保留的份数变少。失败的备份从不删除任何文件。
- **手动备份与迁移前备份**不计入保留规则、不会自动删除（ADR 0015 留给本项的问题），管理员可以在后台删除。
- **结果记录。** 新表 `backup_runs`（核心迁移集）：每次尝试一行，记录类型、状态（`running` / `succeeded` /
  `failed`）、文件、大小、错误、pg-boss 任务与重试次数、按保留规则删掉的文件、开始与结束时间。迁移前备份在迁移
  完成（表已存在）后补记一行。同一任务的上一次尝试或超过 4 小时仍为 `running` 的记录在下一次备份开始时标为
  “中断”。记录保留 90 天。`system/status` 的“备份”一项读它。
- **设置。** 实例配置新增 `backups` 一节（第 13 章“默认值均可在实例配置中修改”）：`time`（`HH:MM`，默认 `03:00`）、
  `keepDaily`（1–60，默认 7）、`keepWeekly`（0–52，默认 4）。没有这一节的旧配置文件取默认值，配置版本不变；
  导出写出这一节。规范第 2 章“实例配置项”的“运营”分组随之写明“备份（时间与保留份数）”，第 3 章 `site` 一行
  加上“数据库备份”（主本 rev 190）。

### 后台与权限

- “设置 → 备份”（`/settings/backups`）：备份状态（下次备份、最近一次每日备份、worker 与心跳；没有 worker 时醒目
  提示“备份不会执行”）、时间与保留、备份文件（下载、删除）、最近 20 次结果（含错误信息与重试次数）、“立即备份”。
  页面上的时间一律按站点时区显示，与计划一致。
- 备份属于 `site` 模块（站点级设置，编辑 ✗），新增权限点 **`site.backups`**（`kind: settings`）：下载备份等于拿走
  整个数据库（密码哈希、加密的凭据、会话），所以与 `site.manage` 分开——只有站点设置权限的自定义角色看不到这一页、
  也不能调用其动作与下载。默认管理员拥有全部权限点。页面、三个动作与下载都先检查权限再碰数据库，编辑与缺少
  `site.backups` 的角色一律 403（`settings/access.test.ts`、`settings/backups/access.test.ts`、E2E）。
- 操作日志：保存设置（`site.update`，目标 `backups`）、`site.backup_start`、`site.backup_download`、
  `site.backup_delete`。
- 开发环境（`vite dev`）没有设置 `BLUEPAX_BACKUPS_DIR` 时不领取备份任务、不排计划，页面显示“未开启”。

### 镜像与部署

- pg-boss 被 Vite / adapter-node 打包进构建产物；它可选导入的 `@opentelemetry/api` 在 SvelteKit 构建分析时要能从
  `apps/cms` 解析，因此列为 `apps/cms` 的生产依赖（随镜像安装，没有注册 OpenTelemetry SDK 时什么也不做，
  `Jobs` 也关闭了 pg-boss 的遥测）。
- 单独的 worker 容器（`BLUEPAX_ROLES=worker`）必须与 web 容器挂载同一个 `backups` 卷：worker 写文件，web 提供下载，
  所以两者在同一台主机。`deploy/README` 写明了这一点、每日备份与恢复步骤（原地恢复与在新服务器上恢复）。

## 影响

- ADR 0015 的“延后”中 `packages/jobs` 与 pg-boss、每日备份、保留策略、后台下载与查看、迁移前备份的清理由本条完成；
  worker 的任务并发（图片处理默认 2）随衍生图改为任务（M3，见 0018）。
- 规范第 12 章“数据库备份可在全新环境中恢复并正常运行”按 M2 范围（媒体来自原 `uploads` 卷）验收，记在
  [M2 验收记录](../acceptance/m2.md)；从 R2 恢复媒体随 M3。
- 新增目录与依赖：`packages/jobs`（pg-boss）、`apps/cms` 的 `@opentelemetry/api`。新增表 `backup_runs` 与 schema `pgboss`。

## 延后

- 备份加密后同步到独立的私有 R2 桶、恢复时从 R2 取媒体：M3（R2 驱动）。
- `system/status` 中的 worker 心跳、队列积压与失败任务、备份检查项：M2 第 7 项（Management API）。
- 衍生图、R2 同步与回填、邮件等其他任务：各自所在的里程碑（0018）。
