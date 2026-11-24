// Writes the GitHub Release body.
//   RELEASE_INFO='<json>' PUBLISHED_PACKAGES='<json>' node scripts/release/notes.ts <out.md>
// Changes come from git-cliff between the previous tag and this one, grouped into the CMS
// (everything outside the published packages) and one group per published package.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { releaseNotes, type ChangeGroup, type PublishedPackage, type ReleaseInfo } from './lib.ts';

const body = readFileSync(new URL('notes-body.tera', import.meta.url), 'utf8');

function changes(args: string[]): string {
  return execFileSync(
    'pnpm',
    ['exec', 'git-cliff', '--latest', '--strip', 'all', '--body', body, ...args],
    { encoding: 'utf8' },
  ).trim();
}

function packageDirs(): Map<string, string> {
  const out = execFileSync('pnpm', ['-r', 'ls', '--json', '--depth', '-1'], { encoding: 'utf8' });
  const dirs = new Map<string, string>();
  for (const p of JSON.parse(out) as { name: string; path: string }[]) {
    dirs.set(p.name, relative(resolve('.'), p.path));
  }
  return dirs;
}

const [outFile] = process.argv.slice(2);
const info = JSON.parse(process.env.RELEASE_INFO ?? 'null') as ReleaseInfo | null;
if (!outFile || !info) {
  console.error("usage: RELEASE_INFO='<json>' PUBLISHED_PACKAGES='<json>' notes.ts <out.md>");
  process.exit(1);
}
const packages = JSON.parse(process.env.PUBLISHED_PACKAGES || '[]') as PublishedPackage[];

const dirs = packageDirs();
const packagePaths = packages.map((p) => `${dirs.get(p.name)}/**`);
const groups: ChangeGroup[] = [
  {
    title: 'CMS and image',
    body: changes(packagePaths.flatMap((path) => ['--exclude-path', path])),
  },
  ...packages.map((p, i) => ({
    title: `npm: ${p.name.replace(/^@[^/]+\//, '')}`,
    body: changes(['--include-path', packagePaths[i]!]),
  })),
];

writeFileSync(outFile, releaseNotes({ info, packages, changes: groups }));
console.log(readFileSync(outFile, 'utf8'));
