// Validates a release tag against BluePax Flow and prints the release information.
//   node scripts/release/info.ts <tag>
// Writes the fields to $GITHUB_OUTPUT when it is set, and always prints them as JSON.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  imageTags,
  parseAnnotation,
  parseTag,
  ReleaseError,
  releaseInfo,
  type PreviousRelease,
} from './lib.ts';

const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const tryGit = (...args: string[]): string | undefined => {
  try {
    return git(...args);
  } catch {
    return undefined;
  }
};

function main(tag: string): void {
  if (git('cat-file', '-t', tag) !== 'tag') {
    throw new ReleaseError(`${tag} must be an annotated tag (git tag -a)`);
  }
  const commit = git('rev-list', '-n', '1', tag);
  if (tryGit('merge-base', '--is-ancestor', commit, 'origin/main') === undefined) {
    throw new ReleaseError(`${tag} does not point to a commit on main`);
  }
  // A release commit on main is `git merge --no-ff dev`; its second parent is the dev commit.
  const devCommit = tryGit('rev-parse', '--verify', '--quiet', `${commit}^2`);
  if (!devCommit) throw new ReleaseError(`${tag} must point to a merge commit of dev into main`);
  const build = Number(git('rev-list', '--count', '--first-parent', devCommit));

  const previous: PreviousRelease[] = [];
  for (const line of git(
    'tag',
    '-l',
    'v*',
    '--format=%(refname:short)%09%(contents:subject)',
  ).split('\n')) {
    const [name, subject] = line.split('\t');
    if (!name || name === tag || subject === undefined) continue;
    try {
      previous.push({ major: parseTag(name).major, codename: parseAnnotation(subject).codename });
    } catch {
      console.warn(`ignoring tag ${name}: it does not follow BluePax Flow`);
    }
  }

  const info = releaseInfo({
    tag,
    annotation: git('tag', '-l', '--format=%(contents:subject)', tag),
    build,
    commit,
    previous,
  });

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const fields = {
      tag: info.tag,
      version: info.version,
      prerelease: String(info.prerelease),
      'dist-tag': info.distTag,
      build: String(info.build),
      codename: info.codename,
      description: info.description,
      commit: info.commit,
      'image-tags': imageTags(info).join(' '),
      json: JSON.stringify(info),
    };
    appendFileSync(
      output,
      Object.entries(fields)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(''),
    );
  }
  console.log(JSON.stringify(info, null, 2));
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error('usage: node scripts/release/info.ts <tag>');
  process.exit(1);
}
try {
  main(tag);
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
