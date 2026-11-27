# 0001 npm 包发布到 GitHub Packages

- 状态：已替代（见 [0017](0017-npm-packages-on-npmjs.md)）；2026-11-24 采纳，2026-11-27 改发 npmjs
- 涉及：规范第 6、10、11、13 章，`.github/workflows/release.yml`，`scripts/release/`

## 背景

规范原方案把 `@bluepax/cms-client` 与 `@bluepax/cms-blocks` 发布到 npm 公共仓库，用 trusted
publishing（OIDC）并附 npm provenance。所有者希望发布全部由 GitHub Actions 完成，不在 npm
上做任何配置，也不维护任何令牌。

## 决策

- 两个包发布到 GitHub Packages 的 npm 仓库 `https://npm.pkg.github.com`，只用 workflow 自带的
  `GITHUB_TOKEN`（`packages: write`），仓库中不保存任何个人令牌。
- 包的 `package.json` 必须有 `publishConfig.registry` 与指向本仓库的 `repository`，发布脚本会检查；
  首次发布即自动关联本仓库。
- GitHub Packages 不支持 npm provenance，改为对发布的 tarball 生成 GitHub 构建来源证明
  （`actions/attest-build-provenance`）。
- 重跑同一标签的发布时，已存在的版本跳过。

## 影响

- 安装公开包同样需要鉴权：本地用带 `read:packages` 的经典个人令牌（classic PAT），其他仓库的
  Actions 需先在包设置中被授予读取权限。外部用户不能匿名 `pnpm add`。
- GitHub Packages 新包默认 Private，首次发布后要在组织的 Packages 设置中手动改为 Public（已写入
  规范第 13 章开工清单）。
- 未经实际发布验证的两点：GitHub 文档未写明是否支持 dist-tag（`--tag beta`）；用 `GITHUB_TOKEN`
  首次创建组织包是否还需改组织设置。首次发布时确认，必要时更新本记录。
