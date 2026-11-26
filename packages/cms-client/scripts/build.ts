// Builds the published package (docs/adr/0013): ESM JavaScript and type declarations from
// `src/` into `dist/`, then loads every entry point under plain Node.js as a check.
// @bluepax/cms-blocks must be built first (`pnpm -r build` runs in dependency order).
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(root, '..', 'cms-blocks', 'dist', 'index.d.ts'))) {
  console.error('build @bluepax/cms-blocks first: pnpm --filter @bluepax/cms-blocks build');
  process.exit(1);
}
rmSync(dist, { recursive: true, force: true });
execFileSync('tsc', ['-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit', cwd: root });
for (const entry of ['index.js', 'contract.js', 'routes.js']) {
  await import(pathToFileURL(join(dist, entry)).href);
}
console.log('@bluepax/cms-client: built dist/');
