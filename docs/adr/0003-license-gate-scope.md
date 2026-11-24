# 0003 许可证检查：生产依赖与开发依赖分开要求

- 状态：已采纳（2026-11-24）
- 涉及：规范第 10 章（约定），`scripts/check-licenses.ts`

## 背景

规范要求依赖只允许宽松许可（MIT、BSD、ISC、Apache-2.0 等），CI 拦截 GPL / AGPL / LGPL，唯一例外是
sharp 的 libvips 预编译包。但测试与构建工具链（Vite 依赖的 lightningcss）使用 MPL-2.0，它不是宽松
许可，也不属于 GPL 家族，且只在开发与构建时使用、不进镜像。

## 决策

- 生产依赖（所有 workspace 包的 `dependencies`，即进镜像的部分）只允许宽松许可白名单。
- 开发依赖只拦截 GPL / AGPL / LGPL 与无法识别的许可。
- libvips 例外按规范保留，对生产与开发依赖都适用。
- 检查覆盖整个 workspace（`pnpm licenses list --recursive`）。

## 影响

- 本解释已写入规范第 10 章（2026-11-24），开发依赖允许 MPL-2.0 等非 GPL 类许可。若以后要求开发依赖同样
  只用宽松许可，需先改规范并替换相关工具链。
