// License gate, see docs/spec/README.md chapter 10.
// - Production dependencies (shipped in the image) must use a permissive license.
// - No dependency at all may use a GPL-family license (GPL / AGPL / LGPL).
// - The only exception is the libvips prebuilt binaries used by sharp (LGPL-3.0,
//   dynamically linked); its license text ships with the image and THIRD_PARTY_NOTICES.md.
import { execFileSync } from 'node:child_process';

const PERMISSIVE = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Python-2.0',
  'Unlicense',
]);

const COPYLEFT = /^(A|L)?GPL/i;

const EXCEPTIONS: { name: RegExp; license: string }[] = [
  { name: /^@img\/sharp-libvips-/, license: 'LGPL-3.0-or-later' },
];

interface Entry {
  name: string;
  versions: string[];
  license: string;
}

function list(prod: boolean): Entry[] {
  const args = ['licenses', 'list', '--json', '--recursive', ...(prod ? ['--prod'] : [])];
  const out = execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const byLicense = JSON.parse(out) as Record<string, Entry[]>;
  return Object.values(byLicense).flat();
}

// Accepts simple SPDX expressions: "A OR B" passes if any part passes, "A AND B" if all do.
function satisfies(expression: string, ok: (id: string) => boolean): boolean {
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/i.test(expr)) return expr.split(/\sOR\s/i).some((part) => satisfies(part, ok));
  if (/\sAND\s/i.test(expr)) return expr.split(/\sAND\s/i).every((part) => satisfies(part, ok));
  return ok(expr);
}

function isException(entry: Entry): boolean {
  return EXCEPTIONS.some((e) => e.name.test(entry.name) && e.license === entry.license);
}

const problems: string[] = [];
const prodNames = new Set<string>();

for (const entry of list(true)) {
  prodNames.add(entry.name);
  if (isException(entry)) continue;
  if (!satisfies(entry.license, (id) => PERMISSIVE.has(id))) {
    problems.push(`${entry.name}@${entry.versions.join(',')}: ${entry.license} (production)`);
  }
}

for (const entry of list(false)) {
  if (prodNames.has(entry.name) || isException(entry)) continue;
  if (!satisfies(entry.license, (id) => !COPYLEFT.test(id) && id !== 'Unknown')) {
    problems.push(`${entry.name}@${entry.versions.join(',')}: ${entry.license}`);
  }
}

if (problems.length > 0) {
  console.error('Disallowed licenses:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('All dependency licenses are allowed.');
