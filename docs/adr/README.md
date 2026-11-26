# 架构决策记录（ADR）

记录实现过程中对[设计规范](../spec/README.md)的解释、补充或偏离，以及背后的原因。
规范仍是唯一实现依据：一条决策若改变了规范要求的行为，先改规范，再在这里记录原因。

格式：每条一个文件 `NNNN-标题.md`，包含「状态 / 背景 / 决策 / 影响」。状态为「已采纳」「已替代（见 NNNN）」或「已废弃」。

| 编号                                               | 标题                                                               | 状态   |
| -------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| [0001](0001-npm-packages-on-github-packages.md)    | npm 包发布到 GitHub Packages                                       | 已采纳 |
| [0002](0002-migration-sets-and-startup-lock.md)    | 按模块分开的迁移集与启动锁                                         | 已采纳 |
| [0003](0003-license-gate-scope.md)                 | 许可证检查：生产依赖与开发依赖分开要求                             | 已采纳 |
| [0004](0004-toolchain-versions.md)                 | 工具链版本：不追最新、遵守最小发布时长                             | 已采纳 |
| [0005](0005-runtime-only-database-url.md)          | `DATABASE_URL` 只在运行时必填                                      | 已采纳 |
| [0006](0006-instance-config-and-setup.md)          | 实例配置文件与初始化向导                                           | 已采纳 |
| [0007](0007-site-settings.md)                      | site 模块：设置的存放与实例配置的扩展                              | 已采纳 |
| [0008](0008-media-local-storage.md)                | media 模块（仅本地存储）：对象、衍生图、引用与站点图片             | 已采纳 |
| [0009](0009-pages-block-pages.md)                  | pages 模块：区块页的存储、区块定义、状态、首页与保留 slug          | 已采纳 |
| [0010](0010-posts-categories-tags-authors.md)      | posts 模块：文章、分类、标签与作者                                 | 已采纳 |
| [0011](0011-route-templates.md)                    | 路由模板：配置、校验、地址生成与路径解析                           | 已采纳 |
| [0012](0012-delivery-preview-api.md)               | Delivery / Preview API：端点、Token、限速、seo 与预览              | 已采纳 |
| [0013](0013-cms-client-and-cms-blocks-packages.md) | `@bluepax/cms-client` 与 `@bluepax/cms-blocks`：契约、客户端与发布 | 已采纳 |
| [0014](0014-minimal-site-example.md)               | `examples/minimal-site`：只依赖 SDK 的最小 SvelteKit 前台          | 已采纳 |
