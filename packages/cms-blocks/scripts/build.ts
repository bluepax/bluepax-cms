// Builds the published package (docs/adr/0013): ESM JavaScript and type declarations from
// `src/` into `dist/`, then the JSON Schema files from the built module, which also checks that
// the output loads under plain Node.js:
//   dist/schemas/rich-text.json       the rich text document
//   dist/schemas/blocks/<key>.json    one file per standard block
//   dist/schemas/index.json           both, as `GET /api/delivery/v1/schema/blocks` returns them
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync('tsc', ['-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit', cwd: root });

const built = (await import(
  pathToFileURL(join(dist, 'index.js')).href
)) as typeof import('../src/index.ts');
const schemas = built.blockJsonSchemas();
const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
write(join(dist, 'schemas', 'index.json'), schemas);
write(join(dist, 'schemas', 'rich-text.json'), schemas.richText);
for (const [key, schema] of Object.entries(schemas.blocks)) {
  write(join(dist, 'schemas', 'blocks', `${key}.json`), schema);
}
console.log(
  `@bluepax/cms-blocks: built dist/ with ${Object.keys(schemas.blocks).length} block schemas`,
);
