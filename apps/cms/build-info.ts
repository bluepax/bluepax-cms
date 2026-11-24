// Build information injected at build time, see docs/spec/README.md chapter 11.
// CI passes the values explicitly (on main the build number comes from the merged dev
// commit); local builds fall back to git.
import { execFileSync } from 'node:child_process';

export interface BuildInfo {
  version: string;
  build: number;
  commit: string;
  builtAt: string;
}

type Git = (args: string[]) => string;

const defaultGit: Git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function buildInfo(
  env: Record<string, string | undefined> = process.env,
  git: Git = defaultGit,
  now: () => Date = () => new Date(),
): BuildInfo {
  const tryGit = (args: string[]): string | undefined => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };

  const rawBuild = env.BLUEPAX_BUILD ?? tryGit(['rev-list', '--count', '--first-parent', 'HEAD']);
  const build = rawBuild === undefined ? 0 : Number(rawBuild);
  if (!Number.isInteger(build) || build < 0) {
    throw new Error(`BLUEPAX_BUILD must be a non-negative integer, got "${rawBuild}"`);
  }

  return {
    version: env.BLUEPAX_VERSION ?? '0.0.0-development',
    build,
    commit: env.BLUEPAX_COMMIT ?? tryGit(['rev-parse', 'HEAD']) ?? 'unknown',
    builtAt: env.BLUEPAX_BUILT_AT ?? now().toISOString(),
  };
}
