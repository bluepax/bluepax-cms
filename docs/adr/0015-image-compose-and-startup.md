# 0015 镜像、compose 快速启动、启动顺序与镜像发布

- 状态：已采纳（2026-11-26）
- 涉及：规范第 9 章（容器与数据、接口与后台任务、启动顺序、网关要求、备份与可观测）、第 10 章（镜像、目录、约定中的
  许可证要求）、第 11 章（构建信息注入、镜像标签、发布流程第 4 步与 Release 正文）、第 12 章“运维与开源”、
  第 13 章（M1 的部署项、M2 的“备份”），`deploy/`、`apps/cms/src/lib/server/runtime.ts`、
  `apps/cms/src/lib/server/backups.ts`、`packages/db/src/backup.ts`、`.github/workflows/image.yml`、
  `ci.yml`、`release.yml`、`scripts/release/`、`scripts/third-party-notices.ts`

## 背景

M1 的最后一项是镜像与部署：规范第 9 章给出了容器、卷、启动顺序与网关要求，第 11 章给出了镜像标签与 Release 正文。
没有规定的有：镜像怎么组装、worker 角色在没有任务时做什么、迁移前备份放在哪里与失败重启时怎么办、`ORIGIN` 与
`BODY_SIZE_LIMIT`（ADR 0008、0012 留给本项）如何保证、`edge` 镜像在什么时机发布。

## 决策

### 镜像

- `deploy/Dockerfile`，从仓库根目录构建（`docker build -f deploy/Dockerfile .`）。三个阶段，基础镜像都是
  `node:26-alpine3.24`（与 `.nvmrc` 一致，在每个 `FROM` 中写明以便 Dependabot 更新）：
  - `build`：在构建机自己的平台上 `pnpm install --frozen-lockfile` 并构建 `@bluepax/cms`（产物是纯 JavaScript，
    多平台镜像也只构建一次）。版本号、build 号、提交 SHA、构建时间由构建参数 `BLUEPAX_VERSION` / `BLUEPAX_BUILD` /
    `BLUEPAX_COMMIT` / `BLUEPAX_BUILT_AT` 传入（镜像内没有 `.git`；空值按未提供处理，本地构建回退到 git 或当前时间）。
  - `deps`：在目标平台上 `pnpm --filter @bluepax/cms deploy --prod`，只装生产依赖——sharp 与 argon2 的预编译二进制
    按平台与 C 库（这里是 musl）区分，所以必须在目标平台安装。随后生成 `THIRD_PARTY_NOTICES.md`。
  - 运行阶段：只复制 `build/`、生产 `node_modules`、迁移目录（`/app/migrations`）、`LICENSE`、
    `THIRD_PARTY_NOTICES.md` 与 `licenses/`；安装 `postgresql18-client`（`pg_dump`）与 `tini`（转发信号、回收
    `pg_dump` 子进程），以内置的非 root 用户 `node`（uid 1000）运行。
- pnpm 12 安装时会按供应链策略（ADR 0004）在线核对锁文件的发布时间，离线安装（`pnpm fetch` + `--offline`）会因缺
  元数据失败，所以两个阶段都在线安装，pnpm 仓库放在 BuildKit 缓存挂载里加速。
- 选 Alpine：仓库里 sharp（`@img/sharp-linuxmusl-*`）与 argon2 都有 musl 预编译包；Alpine 3.24 直接提供
  PostgreSQL 18 客户端，而 Debian 13 只有 17，需另加 PGDG 源。`pg_dump` 不能比服务器旧，18 可以备份 16–18。
- 镜像内的默认环境：`HOST=0.0.0.0`、`PORT=3001`、`BODY_SIZE_LIMIT=256M`、`BLUEPAX_UPLOADS_DIR=/data/uploads`、
  `BLUEPAX_BACKUPS_DIR=/data/backups`、`BLUEPAX_MIGRATIONS_DIR=/app/migrations`、`NODE_ENV=production`。
  `/data/uploads` 与 `/data/backups` 在镜像中属 `node` 用户，命名卷首次挂载时继承这个属主。
- 健康检查：`HEALTHCHECK` 用 Node 自带的 `fetch` 请求 `GET /api/health`（镜像里不装 curl），启动宽限期 10 分钟——
  启动时要先备份、迁移再监听，大库会比较慢。
- 许可证：规范第 10 章要求 libvips（LGPL-3.0）的许可证文本随镜像提供，而 `@img/sharp-libvips-*` 包本身不带许可证
  文件。仓库在 `deploy/licenses/` 存放 LGPL-3.0 与它所补充的 GPL-3.0 原文（取自 Debian `base-files` 的
  `/usr/share/common-licenses/`，与 FSF 原文一致），镜像放在 `/app/licenses/`。`scripts/third-party-notices.ts` 按
  `pnpm licenses list --prod` 列出镜像中的每个第三方包、许可证与它自带的许可证文件，libvips 一项指向上述文本。
  仓库根目录的 `THIRD_PARTY_NOTICES.md`（第 10 章“CI 生成”）不在本项内，以后可复用这个脚本。

### compose 与环境变量

- `deploy/docker-compose.yml`（项目名 `bluepax-cms`）+ `deploy/.env.example`：服务 `cms` 与 `postgres`
  （`postgres:18-alpine`，与开发库、CI 一致；不对外发布端口），卷 `pgdata`、`uploads`、`backups`。
  `cms` 端口发布为 `${BLUEPAX_BIND:-127.0.0.1}:${BLUEPAX_PORT:-3001}:3001`：容器内监听所有地址，宿主机上默认只绑定
  `127.0.0.1:3001`，由同机网关对外（第 9 章“端口默认绑定 127.0.0.1:3001”）。
- 必填项用 compose 的 `${VAR:?…}`：`ORIGIN`、`POSTGRES_PASSWORD`、`APP_SECRET`、`ENCRYPTION_KEY`、
  `BLUEPAX_INSTALL_TOKEN` 缺一个 compose 就拒绝启动。`DATABASE_URL` 由 compose 用 `POSTGRES_PASSWORD` 拼出，所以
  密码要 URL 安全（示例用 `openssl rand -hex`）。
- `.env.example` 默认镜像是 `ghcr.io/bluepax/bluepax-cms:beta`（1.0.0 之前没有 `latest`），生产建议固定版本号；
  compose 文件自身的缺省值是 `latest`。仓库根目录的 `.env.example` 仍是开发用。

### 启动顺序与迁移前备份

- 启动仍在 SvelteKit 的 `init` 钩子里完成，adapter-node 在 `init` 结束后才监听端口；任何一步抛错，进程以退出码 1
  结束，从不对外服务（规范第 9 章）。失败时先写一条结构化日志 `startup failed, not serving`（带数据库给出的原因）。
- 顺序：检查部署设置 → 检查密钥 → 取 advisory lock → 有待执行迁移时备份 → 迁移 → 释放锁 → 按配置文件初始化 →
  结束待升级记录 → 启动角色。
- 备份：`packages/db` 的 `dumpDatabase` 调用 `pg_dump --format=custom`（压缩，用 `pg_restore` 恢复），先写
  `<文件>.partial`，成功后改名；连接取自 `DATABASE_URL`，密码移到 `PGPASSWORD`，不出现在命令行里。
  `DATABASE_URL` 因此要同时能被 node-postgres 与 libpq 识别（TLS 用 `sslmode=`）。文件名
  `pre-migrate-YYYYMMDD-HHMMSSZ.dump`，放在 `BLUEPAX_BACKUPS_DIR`（镜像中为 `backups` 卷）。
- 全新数据库（没有任何迁移集的记录表）不备份：首次启动没有可保护的数据。`runMigrations` 的 `beforeMigrate` 因此多了
  第二个参数 `{ fresh }`。
- **失败重启复用同一份备份**：备份成功后写 `.pending-upgrade.json`（记下备份文件与待执行迁移），启动全部完成后删除。
  启动时若它存在且对应的备份还在，就复用那份备份、不再新做。容器在迁移失败后会按 `restart: unless-stopped` 反复
  重启，若每次都备份，备份卷会被迅速占满；而在下一次成功启动之前没有任何进程对外服务，数据库不会变化，所以复用是
  安全的，并且复用的正是升级前的状态（即使某个迁移集已部分成功）。任何一次成功启动（包括回退到旧版本镜像）都会
  删除这个记录，之后的升级重新备份。
- Drizzle 的每个迁移集在一个事务中执行，失败的迁移集整体回滚；已成功的迁移集保留（迁移只向前）。降级 = 恢复升级前的
  备份并换回旧镜像，步骤写在 `deploy/README.md`。
- `vite dev`：没有设置 `BLUEPAX_BACKUPS_DIR` 时跳过备份并记一条警告（开发机通常没有 `pg_dump`，开发库可以重建）；
  生产构建默认 `/data/backups`。
- 迁移前备份不自动删除。每日备份、保留策略（7 天 + 4 个周日）、后台下载与查看、异地同步和恢复演练都属于 M2 的
  “备份”项（第 13 章），由它决定迁移前备份是否计入保留数量。

### 部署设置的检查

- `ORIGIN` 在生产构建中必填，缺失时启动失败。没有它 adapter-node 会信任请求的 `Host` 头，Delivery API 的媒体地址就
  会随请求变化（可被伪造，或变成网关看到的内网地址，ADR 0012），表单的同源检查也会失败。`ORIGIN` 与
  `BODY_SIZE_LIMIT` 在 `src/env.ts` 中声明（由 adapter-node 自己读取，声明只为启动检查与文档）。
- `BODY_SIZE_LIMIT` 低于 200 MB（第 13 章视频默认上限）时只记警告，不阻止启动：管理员可能有意调低上传上限。
- adapter-node 的 `BODY_SIZE_LIMIT` 对所有路由生效。为了不让未登录也能访问的接口（登录、初始化、Delivery API）接收
  上百 MB 的请求体，应用在 `hooks.server.ts` 中按声明的 `Content-Length` 把上传表单以外的请求限制在 10 MB，超出返回
  413（ADR 0008 提到的“只对上传路由放宽”）。上传表单只有媒体库（`/media`）与媒体详情（`/media/<id>`）两处。
  没有 `Content-Length` 的请求仍由 `BODY_SIZE_LIMIT` 兜底。

### 角色与后台任务

- M1 没有任何后台任务：衍生图同步生成（ADR 0008），邮件、Webhook、定时发布、备份都在 M2 及以后。所以本项**不建
  `packages/jobs`、不引入 pg-boss**，以免先建一个空队列与它的数据库 schema。`BLUEPAX_ROLES` 照常解析：`worker` 角色
  目前不启动任何东西；只有 `worker` 的进程仍然监听端口，但除 `/api/health` 外一律 404（已有行为），供容器健康检查使用。
- 第一个后台任务（预计是 M2 的 Webhook 投递、定时发布或每日备份）随之建立 `packages/jobs` 与 pg-boss：在
  `runtime.ts` 的 `startup()` 末尾按角色启动 worker，pg-boss 的 schema 创建放在 advisory lock 内、迁移之后。

### 网关

- `deploy/gateway/` 提供 Caddy、OpenResty 与 Cloudflare Tunnel 示例。HTTPS 在网关终止。
- 真实 IP 用 adapter-node 的 `ADDRESS_HEADER` / `XFF_DEPTH`：CMS 只监听 `127.0.0.1`，能连上它的只有同机网关，所以
  只信任网关写入的头。Caddy 与 OpenResty 示例都**覆盖**（而不是追加）`X-Forwarded-For` 为网关看到的访客地址，
  配合 `ADDRESS_HEADER=X-Forwarded-For`、`XFF_DEPTH=1`；Cloudflare Tunnel 用 `ADDRESS_HEADER=CF-Connecting-IP`。
  网关前面还有 Cloudflare 代理时，由网关只对 Cloudflare 的地址段信任 `CF-Connecting-IP`。
- `noindex`：应用已对每个响应发 `X-Robots-Tag`（媒体为 `noindex`），并提供禁止全部抓取的 `robots.txt`，网关不再
  重复设置，也不拦截 AI 爬虫。管理界面可加 Cloudflare Access 或 IP 白名单，但 `/api/*` 与 `/uploads/*` 必须在外。
- 网关自身的请求体上限要与 `BODY_SIZE_LIMIT` 一致（nginx 默认 1 MB）；Cloudflare 按套餐限制请求体（Free / Pro
  100 MB），更大的视频上传到不了 CMS，写在示例注释中。

### 镜像发布

- 可复用工作流 `.github/workflows/image.yml`：用 QEMU + Buildx 构建 `linux/amd64` 与 `linux/arm64`，以
  `GITHUB_TOKEN`（`packages: write`）推送到 `ghcr.io/bluepax/bluepax-cms`，输出多平台镜像的 digest。镜像带
  `org.opencontainers.image.source` 标签，GHCR 据此把包关联到本仓库；构建缓存用 GitHub Actions 缓存。
- `edge`：`ci.yml` 的最后一个任务，只在推送到 dev、且其余检查全部通过后运行（不是每次推送都发布，CI 失败的提交不会
  成为 `edge`）。dev 的推送按 `ci.yml` 的并发组依次执行，`edge` 不会被旧提交覆盖。版本号为 `0.0.0-development`，
  build 号与提交照常注入。
- 版本标签：`release.yml` 新增 `image` 任务（在完整 CI 之后、与 npm 并行），标签由 `scripts/release/lib.ts` 的
  `imageTags` 生成：正式版 `X.Y.Z`、`X.Y`、`X`、`latest`，beta 为 `X.0.0-beta.N` 与 `beta`。build 号取 dev 提交的
  序号（与 npm、Release 一致），提交 SHA 为标签所在提交。创建 Release 前必须拿到 digest，Release 正文在“版本”之后
  增加“镜像”一节（标签、digest 与按 digest 拉取的命令），顺序与第 11 章一致。失败后重跑同一标签会重新推送并覆盖
  同名标签。
- `release.yml` 调用 `ci.yml` 时也要给 `packages: write`：GitHub 校验被调用工作流中每个任务申请的权限（包括被跳过的
  `edge`），调用方给不够时整个 release 会在开始前失败。
- 第一次推送会在组织 `bluepax` 下新建私有的容器包；设为 Public（并确认关联本仓库）是第 13 章开工清单中的一项，由
  所有者在 GitHub 上操作。
- Dependabot 新增 `docker`（`deploy/Dockerfile` 的 Node 镜像）与 `docker-compose`（`deploy/` 与 `deploy/dev/` 的
  PostgreSQL 镜像），两者都忽略主版本升级。

## 影响

- 第 12 章“运维与开源”中的 `docker compose up` 从零起实例、升级时先备份再迁移、迁移失败不对外服务、`/api/health`
  与“关于”页显示构建信息，都可以在本地验证；“推送标签后自动发布镜像”在第一次打标签时验证。
- ADR 0002 的“备份属于 M2，`beforeMigrate` 尚未接入”由本条替代：迁移前备份已接入，每日备份仍属 M2。
- ADR 0008 的 `BODY_SIZE_LIMIT` 与 ADR 0012 的 `ORIGIN` 两项延后事项由本条完成。
- 新增环境变量 `BLUEPAX_BACKUPS_DIR`；生产必须设置 `ORIGIN`。

## 延后

- `packages/jobs` 与 pg-boss、worker 的任务并发（图片处理默认 2）：随第一个后台任务（M2）。
  （2026-11-28：`packages/jobs` 与 pg-boss 已由 [0019](0019-jobs-and-daily-backups.md) 完成；图片处理并发随衍生图改为任务，M3。）
- 每日备份、保留策略、后台下载、异地同步、恢复演练与迁移前备份的清理：M2“备份”。
  （2026-11-28：除异地同步（M3，R2）外已由 0019 完成；迁移前备份不自动删除，管理员可在“设置 → 备份”删除。）
- 仓库根目录由 CI 生成的 `THIRD_PARTY_NOTICES.md`、镜像的 SBOM 与签名：需要时再加。
- 镜像瘦身（只在浏览器用到、已被打包进构建产物的依赖如 `@lucide/svelte`、`bits-ui` 仍在生产依赖中）：需要时再拆分
  依赖类别，并相应调整许可证检查的范围（ADR 0003）。
