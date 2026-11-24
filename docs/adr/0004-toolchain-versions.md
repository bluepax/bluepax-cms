# 0004 工具链版本：不追最新、遵守最小发布时长

- 状态：已采纳（2026-11-24）
- 涉及：`package.json`，`pnpm-workspace.yaml`，`.github/dependabot.yml`

## 背景

规范规定了技术栈（SvelteKit、TypeScript、pnpm workspace 等），未规定版本。开工时 TypeScript 最新为
7.x（原生编译器），而 typescript-eslint 与 svelte-check 只支持到 6.x；pnpm 12 默认拒绝安装发布时间
过短的包，以防供应链攻击。

## 决策

- TypeScript 固定 6.0.x，待 typescript-eslint 与 svelte-check 支持 7.x 后再升级。
- 保留 pnpm 的最小发布时长保护，不为个别新包添加例外；需要时选用稍早的版本。
- 依赖的安装脚本默认不执行，只按需在 `pnpm-workspace.yaml` 的 `allowBuilds` 中逐个放行或拒绝
  （esbuild 的安装脚本不需要，已显式拒绝）。
- Dependabot 设 3 天冷却期，与上述保护一致。
- 使用 SvelteKit 3：配置写在 `vite.config.ts`，环境变量在 `apps/cms/src/env.ts` 中声明，通过
  `$app/env/private` 读取。

## 影响

- 升级大版本前先确认 lint 与类型检查工具的兼容性。
