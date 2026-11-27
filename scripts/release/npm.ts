// npm packages for a release, published to GitHub Packages with the workflow's GITHUB_TOKEN.
//   node scripts/release/npm.ts set-version <version>   write the version into every workspace package
//   node scripts/release/npm.ts pack <dir>              pack every public package into <dir>
//   node scripts/release/npm.ts publish <dist-tag> <dir> publish the packed tarballs, skipping published versions
// Authentication comes from the .npmrc written by actions/setup-node (NODE_AUTH_TOKEN).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  checkPublishable,
  NPM_REGISTRY,
  ReleaseError,
  type PublishedPackage,
  type WorkspacePackage,
} from './lib.ts';

interface PackedPackage {
  name: string;
  version: string;
  file: string;
}

const MANIFEST = 'packed.json';

function workspacePackages(): (WorkspacePackage & { version: string })[] {
  const out = execFileSync('pnpm', ['-r', 'ls', '--json', '--depth', '-1'], { encoding: 'utf8' });
  const listed = JSON.parse(out) as { path: string }[];
  const root = resolve('.');
  return listed
    .filter((p) => resolve(p.path) !== root)
    .map((p) => ({
      ...JSON.parse(readFileSync(join(p.path, 'package.json'), 'utf8')),
      path: p.path,
    }));
}

function setVersion(version: string): void {
  for (const pkg of workspacePackages()) {
    const file = join(pkg.path, 'package.json');
    const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    json.version = version;
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    console.log(`${pkg.name} -> ${version}`);
  }
}

function pack(dir: string): void {
  const out = resolve(dir);
  mkdirSync(out, { recursive: true });
  const packed: PackedPackage[] = [];
  for (const pkg of workspacePackages().filter((p) => !p.private)) {
    checkPublishable(pkg);
    // pnpm pack replaces workspace: ranges with the real versions.
    const printed = execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: pkg.path,
      encoding: 'utf8',
    });
    const file = printed.trim().split('\n').at(-1)?.trim();
    if (!file?.endsWith('.tgz'))
      throw new ReleaseError(`could not find the tarball of ${pkg.name}`);
    packed.push({ name: pkg.name, version: pkg.version, file: resolve(out, file) });
    console.log(`packed ${pkg.name}@${pkg.version}`);
  }
  writeFileSync(join(out, MANIFEST), JSON.stringify(packed, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `count=${packed.length}\n`, { flag: 'a' });
  }
}

function isPublished(name: string, version: string): boolean {
  const result = spawnSync(
    'npm',
    ['view', `${name}@${version}`, 'version', '--json', '--registry', NPM_REGISTRY],
    { encoding: 'utf8' },
  );
  if (result.status === 0) return result.stdout.trim().length > 0;
  if (/E404|404 Not Found/.test(result.stderr)) return false;
  throw new ReleaseError(`npm view ${name}@${version} failed:\n${result.stderr}`);
}

function publish(distTag: string, dir: string): void {
  const packed = JSON.parse(readFileSync(join(resolve(dir), MANIFEST), 'utf8')) as PackedPackage[];
  const summary: PublishedPackage[] = [];
  for (const p of packed) {
    if (isPublished(p.name, p.version)) {
      console.log(`skipped ${p.name}@${p.version}: already published`);
      summary.push({ name: p.name, version: p.version, distTag, status: 'skipped' });
      continue;
    }
    execFileSync('npm', ['publish', p.file, '--tag', distTag, '--registry', NPM_REGISTRY], {
      stdio: 'inherit',
    });
    summary.push({ name: p.name, version: p.version, distTag, status: 'published' });
  }
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `packages=${JSON.stringify(summary)}\n`, {
      flag: 'a',
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}

const [command, a, b] = process.argv.slice(2);
try {
  if (command === 'set-version' && a) setVersion(a);
  else if (command === 'pack' && a) pack(a);
  else if (command === 'publish' && (a === 'latest' || a === 'beta') && b) publish(a, b);
  else {
    console.error('usage: npm.ts set-version <version> | pack <dir> | publish <latest|beta> <dir>');
    process.exit(1);
  }
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
