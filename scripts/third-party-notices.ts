// Writes THIRD_PARTY_NOTICES.md for a production install, see docs/spec/README.md chapter 10
// and docs/adr/0015. The image build runs it in the folder `pnpm deploy --prod` wrote:
//   node scripts/third-party-notices.ts <install dir> <out.md>
// Every third-party package is listed with its license and the license files it ships. The
// libvips binaries used by sharp ship no license file: the LGPL-3.0 text (and the GPL-3.0 text
// it builds on) are in licenses/ next to the notices.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Entry {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
const LIBVIPS = /^@img\/sharp-libvips-/;

export function licenseFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort();
}

export function notices(entries: Entry[], read: (path: string) => [string, string][]): string {
  const lines = [
    '# Third-party notices',
    '',
    'BluePax CMS (MIT, see LICENSE) ships the following third-party packages in this image.',
    '',
  ];
  const sorted = entries
    .filter((e) => !e.name.startsWith('@bluepax/'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    lines.push(`## ${entry.name}@${entry.versions.join(', ')}`, '', `License: ${entry.license}`);
    if (entry.homepage) lines.push(`Homepage: ${entry.homepage}`);
    lines.push('');
    if (LIBVIPS.test(entry.name)) {
      lines.push(
        'Prebuilt libvips binaries, dynamically linked by sharp. The license texts are in',
        '`licenses/LGPL-3.0.txt` and `licenses/GPL-3.0.txt`; the sources are at',
        'https://github.com/lovell/sharp-libvips.',
        '',
      );
    }
    for (const [file, text] of read(entry.paths[0] ?? '')) {
      lines.push(`### ${file}`, '', '```text', text.trimEnd(), '```', '');
    }
  }
  return lines.join('\n');
}

function main(dir: string, out: string): void {
  const json = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = Object.values(JSON.parse(json) as Record<string, Entry[]>).flat();
  const read = (path: string): [string, string][] =>
    path
      ? licenseFiles(path).map((file): [string, string] => [
          file,
          readFileSync(join(path, file), 'utf8'),
        ])
      : [];
  writeFileSync(out, notices(entries, read));
  console.log(`wrote ${out}: ${entries.length} packages`);
}

if (import.meta.main) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node scripts/third-party-notices.ts <install dir> <out.md>');
    process.exit(1);
  }
  main(dir, out);
}
