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

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  ignores: [isDependabotCommit],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'revert', 'chore', 'init'],
    ],
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
