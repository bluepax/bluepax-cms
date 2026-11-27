# 0017 npm 包改发 npmjs

- 状态：已采纳（2026-11-27）
- 取代：[0001](0001-npm-packages-on-github-packages.md)
- 涉及：规范第 6、10、11、13 章（主本 rev 188），`.github/workflows/release.yml`、`.github/actions/setup/action.yml`、
  `scripts/release/`、两个包的 `package.json` 与 README、根目录 README、`examples/minimal-site` 的 README、`CONTRIBUTING.md`

## 背景

0001 把 `@bluepax/cms-client` 与 `@bluepax/cms-blocks` 发到 GitHub Packages，`1.0.0-beta.34` 已按此发布并设为公开。
GitHub Packages 安装公开包也要令牌：本机要带 `read:packages` 的经典个人令牌，别的仓库的 Actions 还要在包设置里单独授权，
前台接入门槛高。2026-11-27 所有者决定：npm 包改发 npmjs，GitHub 上不再生成公开的 npm 包，并在项目简介中说明。
GHCR 镜像 `ghcr.io/bluepax/bluepax-cms` 不受影响。

## 决策

- **仓库。** 两个包发到 `https://registry.npmjs.org`，作用域是所有者的 npmjs 组织 `bluepax`。`publishConfig` 写
  `registry` 与 `access: public`（带作用域的包不写就按受限发布），`scripts/release` 发布前检查这两项与
  `repository.url`。安装不需要令牌、`.npmrc` 或任何权限设置：`pnpm add @bluepax/cms-client@<CMS 版本>`。
- **认证：npm 受信任发布（trusted publishing）。** `release.yml` 的 `npm` 任务用本次运行的 GitHub OIDC 令牌向 npm
  换取一次性的发布凭据，仓库与 Actions secret 里都没有 npm 令牌。npm 的要求：GitHub 托管的 runner、`id-token: write`、
  npm CLI ≥ 11.5.1（`.nvmrc` 的 Node 26 自带 npm 11.x；`scripts/release/npm.ts publish` 先检查版本）。npm 上登记的
  workflow 文件名是触发运行的那个文件，所以 `npm` 任务直接写在 `release.yml` 里，不放进被调用的 workflow；改名
  `release.yml` 须在 npmjs 删除并重建受信任发布配置。`setup` 动作不再为 npm 写带令牌的 `.npmrc`（去掉 `registry-url` 输入）。
- **来源证明。** 经受信任发布时 npm 为每个 tarball 签发 provenance，包页面显示构建它的提交与运行。脚本仍显式传
  `--provenance`：拿不到 OIDC 令牌时直接失败，而不是发出一个没有来源证明的版本。npm 核对 `repository.url` 与构建所在
  的公开仓库一致（区分大小写）。0001 中对 tarball 另做的 GitHub 构建来源证明（`actions/attest-build-provenance`）不再需要。
- **权限。** `npm` 任务只保留 `contents: read` 与 `id-token: write`，去掉只为 GitHub Packages 准备的 `packages: write`
  与为 GitHub 来源证明准备的 `attestations: write`。镜像任务 `image` 与 `ci`（其中的 `edge` 任务）推送 GHCR，仍需
  `packages: write`，不变。
- **首次发布。** 受信任发布要求包已存在（npm 的 `npm trust` 文档写明 “must already exist on the npm registry”），所以
  每个包的第一个版本由所有者在本机发布：
  1. 所有者在 npmjs 账号上开启双重验证，确认自己是组织 `bluepax` 的 owner。
  2. 首个 npmjs 版本是本改动合并后的下一个 beta `1.0.0-beta.N`，不补发 `1.0.0-beta.34`（它的 README 写的是 GitHub
     Packages 的安装方法，包页面会一直显示它）。发版时在推送 main 与标签之前，从发布提交用 `scripts/release/npm.ts`
     的 `set-version` 与 `pack` 打出与 CI 相同的 tarball，所有者 `npm login` 后执行
     `npm publish <tarball> --tag beta --access public`（验证码自己输入）。之后推送标签，`release.yml` 看到两个版本已存在
     便跳过（Release 正文标 “already published”），镜像与 Release 照常发布。这一个版本没有 npm 来源证明。
  3. 下一次发版推送标签前 2 天内，为两个包各配置一次受信任发布：
     `npm trust github @bluepax/cms-client --file release.yml --repo bluepax/bluepax-cms --allow-publish`（cms-blocks
     同样；需 npm ≥ 11.15.0 与账号双重验证），或在 npmjs 包设置的 Trusted Publisher 中填写同样的内容。npm 规定新配置
     2 天内没有成功发布即作废、只能删除重建。2026-09-03 之后新建的配置默认只允许暂存发布（`npm stage publish`，每次要
     所有者在 npmjs 批准），这里明确允许直接发布，发版不需要人工批准。
  4. 第一次经受信任发布成功后，把两个包的 Publishing access 设为 “Require two-factor authentication and disallow
     tokens”：受信任发布不受影响，任何令牌都不能再发布。
- **dist-tag。** 仍按第 11 章：beta 为 `beta`，正式版为 `latest`。npm 文档没有写明新包只带 `--tag beta` 首发时注册表
  是否同时设 `latest`；首发后用 `npm view @bluepax/cms-client dist-tags` 核对并补记在这里。在 1.0.0 之前，README 一律
  写 `@beta` 或与 CMS 相同的版本号，不依赖 `latest`。
- **GitHub Packages 上的旧包。** 不再往 GitHub Packages 发布。`@bluepax/cms-client`、`@bluepax/cms-blocks`
  （`1.0.0-beta.34`）在 npmjs 首个版本上线后由所有者在 GitHub 网页上删除，只删这两个 npm 包，GHCR 镜像保留。
  GitHub 不允许把公开包改回私有；删除后 30 天内可以恢复。`docs/acceptance/m1.md` 中当时的记录不改，只加后记。
- **迁移。** 以前从 GitHub Packages 安装的前台：从 `.npmrc` 删除 `@bluepax:registry=https://npm.pkg.github.com` 与
  `//npm.pkg.github.com/:_authToken=…` 两行，去掉不再需要的令牌（Docker 构建也不再需要构建密钥），再从 npmjs 安装与
  CMS 相同的版本；锁文件里指向 `npm.pkg.github.com` 的条目随重新安装更新。`1.0.0-beta.34` 不在 npmjs 上，还在用它的
  CMS 与前台一起升到 npmjs 上的版本。两个包的 README 与根目录 README 写了同样的说明。

## 影响

- 前台安装是普通的 `pnpm add` / `npm install`，不再需要令牌、`.npmrc`、包权限或 Docker 构建密钥。
- 从第二个 npmjs 版本起，每个版本都有 npm 来源证明，`npm audit signatures` 可以校验。
- 发布链路多了 npmjs 账号这一环：受信任发布配置缺失、过期或与 `release.yml` 不符时，`npm` 任务以 `ENEEDAUTH` 失败，
  不创建 Release；修好后对同一标签重跑，已发布的版本自动跳过。
- Release 正文的 npm 一节改为 “npm packages (npmjs)”，链接指向 `https://www.npmjs.com/package/<包名>/v/<版本>`。
- 0001 标为已替代；0013 中“首次发布时确认 GitHub Packages 的 dist-tag 与组织包权限”改为本记录的首次发布步骤。
