import type { UserConfig } from '@commitlint/types';

// BluePax Flow commit rules, see docs/spec/README.md chapter 11.
// Dependabot writes "Bump x from 1 to 2" (sentence case) and cannot be configured otherwise.
// Its commits carry both its sign-off and its metadata block, which ordinary commits do not.
export function isDependabotCommit(message: string): boolean {
  return (
    /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/m.test(message) &&
    /^updated-dependencies:$/m.test(message)
  );
}

const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'revert',
  'chore',
  'init',
];

// The release commit on main is `<codename>(vX.Y.Z[-beta.N]): <summary>` (chapter 11, e.g.
// `swift(v1.0.0-beta.34): …`): the codename stands where a type would, so the type and scope
// rules cannot apply to it. Only the subject is matched, and a real type never counts as a codename.
const RELEASE_SUBJECT =
  /^([a-z]+)\(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-beta\.[1-9]\d*)?\): \S/;

export function isReleaseCommit(message: string): boolean {
  const match = RELEASE_SUBJECT.exec(message.split('\n', 1)[0] ?? '');
  return match !== null && !TYPES.includes(match[1] ?? '');
}

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  ignores: [isDependabotCommit, isReleaseCommit],
  rules: {
    'type-enum': [2, 'always', TYPES],
    // Scope is a module ID or a package name.
    'scope-enum': [
      2,
      'always',
      [
        // core modules
        'dashboard',
        'site',
        'pages',
        'posts',
        'media',
        'seo',
        'api',
        'users',
        // optional modules
        'catalog',
        'inquiries',
        'regions',
        'tracking',
        'insights',
        'ai',
        // packages and apps
        'cms',
        'core',
        'db',
        'jobs',
        'presets',
        'storage',
        'cms-blocks',
        'cms-client',
        'minimal-site',
        'deploy',
        // housekeeping
        'deps',
        'release',
      ],
    ],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // DCO: every commit is signed off (git commit -s).
    'signed-off-by': [2, 'always', 'Signed-off-by:'],
  },
};

export default config;
