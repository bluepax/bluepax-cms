// Generates the next migration for one migration set from its schema file:
//   pnpm --filter @bluepax/db generate <set> [label]
// The set is `core` or a module ID; its schema lives in src/schema/<set>.ts and its
// migrations in migrations/<set>/.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const [set, label] = process.argv.slice(2);
if (!set || !/^[a-z][a-z0-9_]*$/.test(set)) {
  console.error('usage: pnpm --filter @bluepax/db generate <set> [label]');
  process.exit(1);
}
const schema = `src/schema/${set}.ts`;
if (!existsSync(schema)) {
  console.error(`schema file ${schema} does not exist`);
  process.exit(1);
}

execFileSync(
  'pnpm',
  [
    'exec',
    'drizzle-kit',
    'generate',
    '--dialect=postgresql',
    `--schema=${schema}`,
    `--out=migrations/${set}`,
    ...(label ? [`--name=${label}`] : []),
  ],
  { stdio: 'inherit' },
);
