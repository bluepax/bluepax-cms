# 0002 按模块分开的迁移集与启动锁

- 状态：已采纳（2026-11-24）
- 涉及：规范第 4 章（数据库）、第 9 章（启动顺序），`packages/db`，`apps/cms/src/lib/server/runtime.ts`

## 背景

规范要求结构只经迁移修改、模块迁移在模块目录内、关闭模块不删表；启动时先取得 PostgreSQL
advisory lock，再检查并执行迁移（有待执行迁移时先全量备份），失败则不对外服务。Drizzle 的迁移器
一次只处理一个目录、一张迁移记录表。

## 决策

- 每个迁移集一个目录 `packages/db/migrations/<集>/`，对应 schema `packages/db/src/schema/<集>.ts`；
  集名为 `core`（基础表）或模块 ID，用 `pnpm --filter @bluepax/db generate <集> <标签>` 生成。
- 每个迁移集有自己的迁移记录表 `drizzle.__migrations_<集>`；`core` 总是最先执行，其余按模块依赖顺序。
- 启动时在一个连接上持有固定键的 advisory lock 完成检查与迁移，多个进程同时启动也只会迁移一次。
- 迁移前的回调 `beforeMigrate` 只在有待执行迁移时调用，用于全量备份。

## 影响

- 模块清单的 `migrations` 字段声明其迁移集名，未声明的模块不建表。
- 备份属于 M2，在此之前 `beforeMigrate` 尚未接入，升级前请自行备份。
- 迁移目录在运行时由 `BLUEPAX_MIGRATIONS_DIR` 指定（镜像中需设置），开发时默认指向仓库内目录。
