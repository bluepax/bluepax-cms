# 部署 BluePax CMS

[English](README.md) | 简体中文

一个站点一个实例：`cms` 容器（管理界面、全部接口与后台角色在同一个 Node.js 进程中）加 PostgreSQL，用 docker compose
运行，HTTPS 在前面的网关终止。背景与决策见[设计规范](../docs/spec/README.md)第 9 章与
[ADR 0015](../docs/adr/0015-image-compose-and-startup.md)。

| 文件                 | 用途                                                  |
| -------------------- | ----------------------------------------------------- |
| `docker-compose.yml` | `cms` + `postgres`，卷 `pgdata`、`uploads`、`backups` |
| `.env.example`       | 全部设置，复制为 `.env`                               |
| `gateway/`           | Caddy、OpenResty 与 Cloudflare Tunnel 示例            |
| `Dockerfile`         | 镜像 `ghcr.io/bluepax/bluepax-cms`                    |
| `dev/`               | 仅用于开发的数据库，不要用于生产                      |

## 快速开始

需要带 compose 插件的 Docker。在一个空目录中：

```bash
curl -fsSLO https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/.env.example
```

填写 `.env`：`ORIGIN`（CMS 的公开地址；本机试用可填 `http://localhost:3001`）与四个密钥，每个旁边都写了生成用的
`openssl` 命令。然后：

```bash
docker compose up -d
```

首次启动会建库并执行全部迁移；`docker compose ps` 中 `cms` 显示 `healthy` 即可访问。打开 `ORIGIN`，在初始化向导中
输入 `BLUEPAX_INSTALL_TOKEN`，选择企业或博客预设并创建第一个管理员。

如需无交互初始化空实例：把实例配置文件放进 `./config/`，取消 `docker-compose.yml` 中 `./config:/config:ro` 一行的
注释，并设置 `BLUEPAX_CONFIG_FILE=/config/<文件>.yaml`（示例见 `examples/config/`）。

## 设置

全部设置都是 `.env` 中的环境变量，密钥不放在任何其他地方。

| 变量                           | 说明                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ORIGIN`                       | 必填。CMS 的公开地址。Delivery API 的媒体地址以它开头，表单提交按它做同源检查；未设置时 CMS 拒绝启动。 |
| `POSTGRES_PASSWORD`            | 必填。只在创建 `pgdata` 卷时使用，之后修改不会改变数据库密码。                                         |
| `APP_SECRET`、`ENCRYPTION_KEY` | 必填。`ENCRYPTION_KEY` 请在服务器之外另存一份：恢复备份后要用同一个密钥才能读出加密保存的凭据。        |
| `BLUEPAX_INSTALL_TOKEN`        | 必填。初始化向导会要求输入。                                                                           |
| `BLUEPAX_IMAGE`                | 镜像与标签。生产环境固定版本号，升级时修改它。                                                         |
| `BLUEPAX_BIND`、`BLUEPAX_PORT` | CMS 在宿主机上监听的地址，默认 `127.0.0.1:3001`。                                                      |
| `ADDRESS_HEADER`、`XFF_DEPTH`  | 由网关写入的访客 IP 头（见下文）。                                                                     |
| `BODY_SIZE_LIMIT`              | 请求体上限，默认 `256M`。必须大于最大上传上限（视频默认 200 MB）；上传以外的请求限制在 10 MB。         |
| `BLUEPAX_ROLES`                | `web`、`worker` 或两者（默认）。M1 还没有后台任务。                                                    |
| `BLUEPAX_CONFIG_FILE`          | 可选，首次启动时用于无交互初始化的实例配置文件。                                                       |

卷：`pgdata`（数据库）、`uploads`（本地媒体存储，`/data/uploads`）与 `backups`（`/data/backups`）。数据库备份不含
媒体文件：请自行备份 `uploads` 卷，或在 R2 镜像可用后接入。

## 网关

CMS 只监听 `127.0.0.1`，由同机网关终止 HTTPS 并转发。示例：

- [`gateway/Caddyfile`](gateway/Caddyfile)：自动申请证书。`.env`：`ADDRESS_HEADER=X-Forwarded-For`、`XFF_DEPTH=1`。
- [`gateway/openresty.conf`](gateway/openresty.conf)：OpenResty 或 nginx。`.env` 同上；需调大 `client_max_body_size`
  （默认 1 MB）。
- [`gateway/cloudflared.yml`](gateway/cloudflared.yml)：Cloudflare Tunnel，服务器无需开放端口。`.env`：
  `ADDRESS_HEADER=CF-Connecting-IP`。Cloudflare 按套餐限制请求体大小（Free 与 Pro 为 100 MB）。

两个反向代理示例都把 `X-Forwarded-For` 覆盖为网关看到的那一个地址，CMS 只信任这一层代理。网关前面还有 Cloudflare
代理时，网关只对 Cloudflare 的地址段从 `CF-Connecting-IP` 取访客地址（示例中有注释）。

CMS 对每个响应都返回 `X-Robots-Tag: noindex`，并提供禁止全部抓取的 `robots.txt`；不要在网关拦截 AI 爬虫。管理界面
可以放在 Cloudflare Access 或 IP 白名单之后，但 `/api/*` 与 `/uploads/*` 必须让前台能够访问。

## 启动、升级与备份

每次启动时，在开始监听之前，CMS 会：

1. 取得 PostgreSQL advisory lock（多个容器同时启动也只迁移一次）；
2. 检查待执行的迁移，有则先写一份全量备份 `/data/backups/pre-migrate-<UTC 时间>.dump`（`pg_dump` custom 格式；
   全新的空数据库不备份）；
3. 执行迁移、释放锁，然后启动。

任何一步失败，容器都会退出、不对外服务：`docker compose ps` 显示它在重启且不健康，`docker compose logs cms` 最后是
`startup failed, not serving`。升级持续失败期间，每次重启都复用第一次尝试时的备份，不会重复备份；下一次成功启动后
结束复用。

升级：修改 `BLUEPAX_IMAGE` 后执行 `docker compose up -d`。迁移只向前，回到旧版本需要恢复升级前的备份。

查看备份：

```bash
docker compose run --rm --no-deps --entrypoint ls cms -l /data/backups
```

恢复某个备份（会替换整个数据库）并换回旧镜像：

```bash
docker compose stop cms
docker compose exec postgres dropdb -U bluepax bluepax
docker compose exec postgres createdb -U bluepax bluepax
docker compose run --rm --no-deps -T --entrypoint cat cms /data/backups/pre-migrate-20261126-225400Z.dump \
  | docker compose exec -T postgres pg_restore -U bluepax -d bluepax
# 在 .env 中把 BLUEPAX_IMAGE 改回之前的版本，然后
docker compose up -d
```

迁移前备份不会自动删除，请手动清理旧文件。带保留策略的每日备份在后续里程碑（M2）提供。

## 健康检查与版本

`GET /api/health` 无需登录，返回状态、版本号、build 号、构建时间与提交 SHA，与后台“关于”页一致。镜像的健康检查
调用的就是它。

```bash
curl -s http://127.0.0.1:3001/api/health
```

## 构建镜像

在仓库根目录：

```bash
docker build -f deploy/Dockerfile -t bluepax-cms:local \
  --build-arg BLUEPAX_BUILD="$(git rev-list --count --first-parent HEAD)" \
  --build-arg BLUEPAX_COMMIT="$(git rev-parse HEAD)" .
```

然后设置 `BLUEPAX_IMAGE=bluepax-cms:local`。已发布的镜像标签：正式版 `X.Y.Z`、`X.Y`、`X` 与 `latest`，beta 为
`X.0.0-beta.N` 与 `beta`，dev 每次合入发布 `edge`。
