// Release rules from docs/spec/README.md chapter 11 (BluePax Flow), kept free of I/O
// so they can be unit tested. The CLI scripts next to this file do the git and npm calls.

export const NPM_REGISTRY = 'https://npm.pkg.github.com';
export const REPOSITORY = 'bluepax/bluepax-cms';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const IMAGE = 'ghcr.io/bluepax/bluepax-cms';

export class ReleaseError extends Error {
  override name = 'ReleaseError';
}

export interface ParsedTag {
  tag: string;
  version: string;
  major: number;
  prerelease: boolean;
  /** The N of `X.0.0-beta.N`, which must equal the build number. */
  betaBuild?: number;
}

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;

export function parseTag(tag: string): ParsedTag {
  const m = TAG.exec(tag);
  if (!m) throw new ReleaseError(`tag "${tag}" must look like vX.Y.Z or vX.0.0-beta.N`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major < 1) throw new ReleaseError(`tag "${tag}": versions start at 1.0.0-beta.1`);
  if (m[4] !== undefined && (minor !== 0 || patch !== 0)) {
    throw new ReleaseError(`tag "${tag}": only a new major version X.0.0 has betas`);
  }
  return {
    tag,
    version: tag.slice(1),
    major,
    prerelease: m[4] !== undefined,
    ...(m[4] !== undefined ? { betaBuild: Number(m[4]) } : {}),
  };
}

export interface Annotation {
  codename: string;
  description: string;
}

/** Tag annotation subject: `<codename>; <English description>`, e.g. `swift; first flight`. */
export function parseAnnotation(subject: string): Annotation {
  const m = /^([a-z]+); (.+)$/.exec(subject.trim());
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new ReleaseError(
      `tag annotation "${subject}" must look like "<codename>; <description>", e.g. "swift; first flight"`,
    );
  }
  if (!/^[\x20-\x7e]+$/.test(m[2])) {
    throw new ReleaseError('the tag annotation description must be written in English');
  }
  return { codename: m[1], description: m[2] };
}

export interface PreviousRelease {
  major: number;
  codename: string;
}

/** All versions of one major share a codename; a codename is never reused for another major. */
export function checkCodename(major: number, codename: string, previous: PreviousRelease[]): void {
  for (const p of previous) {
    if (p.major === major && p.codename !== codename) {
      throw new ReleaseError(
        `major ${major} already uses codename "${p.codename}", not "${codename}"`,
      );
    }
    if (p.major !== major && p.codename === codename) {
      throw new ReleaseError(`codename "${codename}" was already used by major ${p.major}`);
    }
  }
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  prerelease: boolean;
  distTag: 'latest' | 'beta';
  build: number;
  codename: string;
  description: string;
  commit: string;
}

export function releaseInfo(input: {
  tag: string;
  annotation: string;
  build: number;
  commit: string;
  previous: PreviousRelease[];
}): ReleaseInfo {
  const tag = parseTag(input.tag);
  const { codename, description } = parseAnnotation(input.annotation);
  checkCodename(tag.major, codename, input.previous);
  if (!Number.isInteger(input.build) || input.build < 1) {
    throw new ReleaseError(`invalid build number ${input.build}`);
  }
  if (tag.betaBuild !== undefined && tag.betaBuild !== input.build) {
    throw new ReleaseError(
      `${input.tag}: the beta number must be the build number of the released dev commit (${input.build})`,
    );
  }
  return {
    tag: tag.tag,
    version: tag.version,
    prerelease: tag.prerelease,
    distTag: tag.prerelease ? 'beta' : 'latest',
    build: input.build,
    codename,
    description,
    commit: input.commit,
  };
}

/**
 * Image tags of a release (chapter 11): `X.Y.Z`, `X.Y`, `X` and `latest`; a beta gets
 * `X.0.0-beta.N` and `beta`. The first tag is the release's own.
 */
export function imageTags(info: Pick<ReleaseInfo, 'version' | 'prerelease'>): string[] {
  if (info.prerelease) return [info.version, 'beta'];
  const [major, minor] = info.version.split('.');
  return [info.version, `${major}.${minor}`, `${major}`, 'latest'];
}

export interface ReleaseImage {
  tags: string[];
  /** Digest of the pushed multi-platform image, `sha256:…`. */
  digest: string;
}

export interface WorkspacePackage {
  name: string;
  path: string;
  private?: boolean;
  publishConfig?: { registry?: string };
  repository?: string | { url?: string };
}

/** A package that is not private is published to GitHub Packages and must be set up for it. */
export function checkPublishable(pkg: WorkspacePackage): void {
  if (!pkg.name.startsWith('@bluepax/')) {
    throw new ReleaseError(`${pkg.name}: published packages must use the @bluepax scope`);
  }
  if (pkg.publishConfig?.registry !== NPM_REGISTRY) {
    throw new ReleaseError(`${pkg.name}: publishConfig.registry must be ${NPM_REGISTRY}`);
  }
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const normalized = url?.replace(/^git\+/, '').replace(/\.git$/, '');
  if (normalized !== REPOSITORY_URL) {
    // GitHub links the package to this repository through this field.
    throw new ReleaseError(`${pkg.name}: repository.url must be git+${REPOSITORY_URL}.git`);
  }
}

export function packagePageUrl(name: string): string {
  return `${REPOSITORY_URL}/pkgs/npm/${name.replace(/^@[^/]+\//, '')}`;
}

export interface PublishedPackage {
  name: string;
  version: string;
  distTag: string;
  status: 'published' | 'skipped';
}

export interface ChangeGroup {
  title: string;
  /** Markdown from git-cliff; empty when the group has no changes. */
  body: string;
}

function releaseImageLines(image: ReleaseImage): string[] {
  const [own, ...others] = image.tags;
  if (!own) throw new ReleaseError('the release image has no tags');
  if (!/^sha256:[0-9a-f]{64}$/.test(image.digest)) {
    throw new ReleaseError(`invalid image digest "${image.digest}"`);
  }
  const also = others.map((t) => `\`${t}\``).join(', ');
  return [
    `- \`${IMAGE}:${own}\`${also ? `, also tagged ${also}` : ''}`,
    `- Digest: \`${image.digest}\``,
    `- Pull by digest: \`docker pull ${IMAGE}@${image.digest}\``,
  ];
}

export function releaseNotes(input: {
  info: ReleaseInfo;
  image: ReleaseImage;
  packages: PublishedPackage[];
  changes: ChangeGroup[];
}): string {
  const { info } = input;
  const lines = [
    '## Version',
    '',
    `- Version: \`${info.tag}\``,
    `- Codename: ${info.codename}`,
    `- Build: ${info.build}`,
    `- Commit: ${info.commit}`,
    '',
    '## Image',
    '',
    ...releaseImageLines(input.image),
    '',
    '## npm packages (GitHub Packages)',
    '',
  ];
  if (input.packages.length === 0) {
    lines.push('No npm packages in this release.');
  } else {
    for (const p of input.packages) {
      const note = p.status === 'skipped' ? ' (already published)' : '';
      lines.push(
        `- [\`${p.name}@${p.version}\`](${packagePageUrl(p.name)}), dist-tag \`${p.distTag}\`${note}`,
      );
    }
  }
  lines.push('', '## Changes');
  for (const group of input.changes) {
    lines.push('', `### ${group.title}`, '');
    lines.push(group.body.trim() || 'No changes, version synced only.');
  }
  return lines.join('\n') + '\n';
}
