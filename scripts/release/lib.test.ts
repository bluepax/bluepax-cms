import { describe, expect, it } from 'vitest';
import {
  checkCodename,
  checkPublishable,
  packagePageUrl,
  parseAnnotation,
  parseTag,
  releaseInfo,
  imageTags,
  releaseNotes,
} from './lib.ts';

describe('parseTag', () => {
  it('accepts releases and betas of a new major', () => {
    expect(parseTag('v1.2.3')).toEqual({
      tag: 'v1.2.3',
      version: '1.2.3',
      major: 1,
      prerelease: false,
    });
    expect(parseTag('v2.0.0-beta.512')).toMatchObject({ prerelease: true, betaBuild: 512 });
  });

  it('rejects betas of minor or patch versions', () => {
    expect(() => parseTag('v1.1.0-beta.3')).toThrow(/only a new major/);
    expect(() => parseTag('v1.0.1-beta.3')).toThrow(/only a new major/);
  });

  it('rejects other formats and versions below 1', () => {
    for (const tag of [
      '1.0.0',
      'v1.0',
      'v1.0.0-rc.1',
      'v1.0.0-beta.0',
      'v01.0.0',
      'v1.0.0+build.3',
    ]) {
      expect(() => parseTag(tag)).toThrow(/must look like/);
    }
    expect(() => parseTag('v0.9.0')).toThrow(/start at 1.0.0-beta.1/);
  });
});

describe('parseAnnotation', () => {
  it('splits codename and description', () => {
    expect(parseAnnotation('swift; first flight')).toEqual({
      codename: 'swift',
      description: 'first flight',
    });
  });

  it('rejects other formats and non-English descriptions', () => {
    expect(() => parseAnnotation('first flight')).toThrow(/<codename>; <description>/);
    expect(() => parseAnnotation('Swift; first flight')).toThrow(/<codename>; <description>/);
    expect(() => parseAnnotation('swift; 首次发布')).toThrow(/English/);
  });
});

describe('checkCodename', () => {
  const previous = [{ major: 1, codename: 'swift' }];

  it('keeps one codename per major', () => {
    expect(() => checkCodename(1, 'swift', previous)).not.toThrow();
    expect(() => checkCodename(1, 'kestrel', previous)).toThrow(/already uses codename "swift"/);
  });

  it('never reuses a codename for another major', () => {
    expect(() => checkCodename(2, 'kestrel', previous)).not.toThrow();
    expect(() => checkCodename(2, 'swift', previous)).toThrow(/already used by major 1/);
  });
});

describe('releaseInfo', () => {
  const base = { annotation: 'swift; first flight', commit: 'abc', previous: [] };

  it('uses the beta dist-tag for betas and latest otherwise', () => {
    expect(releaseInfo({ ...base, tag: 'v1.0.0-beta.9', build: 9 })).toMatchObject({
      version: '1.0.0-beta.9',
      distTag: 'beta',
      prerelease: true,
      build: 9,
      codename: 'swift',
    });
    expect(releaseInfo({ ...base, tag: 'v1.0.0', build: 12 }).distTag).toBe('latest');
  });

  it('requires the beta number to match the build number', () => {
    expect(() => releaseInfo({ ...base, tag: 'v1.0.0-beta.9', build: 10 })).toThrow(/build number/);
  });
});

describe('checkPublishable', () => {
  const ok = {
    name: '@bluepax/cms-client',
    path: '/repo/packages/cms-client',
    publishConfig: { registry: 'https://npm.pkg.github.com' },
    repository: { url: 'git+https://github.com/bluepax/bluepax-cms.git' },
  };

  it('accepts a package set up for GitHub Packages', () => {
    expect(() => checkPublishable(ok)).not.toThrow();
  });

  it('rejects a missing registry, repository or scope', () => {
    expect(() => checkPublishable({ ...ok, publishConfig: {} })).toThrow(/publishConfig/);
    expect(() => checkPublishable({ ...ok, repository: 'https://github.com/x/y' })).toThrow(
      /repository/,
    );
    expect(() => checkPublishable({ ...ok, name: 'cms-client' })).toThrow(/@bluepax scope/);
  });
});

describe('imageTags', () => {
  it('tags a release with its version, minor, major and latest', () => {
    expect(imageTags({ version: '1.2.3', prerelease: false })).toEqual([
      '1.2.3',
      '1.2',
      '1',
      'latest',
    ]);
  });

  it('tags a beta with its version and beta only', () => {
    expect(imageTags({ version: '2.0.0-beta.512', prerelease: true })).toEqual([
      '2.0.0-beta.512',
      'beta',
    ]);
  });
});

describe('releaseNotes', () => {
  const info = releaseInfo({
    tag: 'v1.0.0-beta.9',
    annotation: 'swift; first flight',
    build: 9,
    commit: 'abc123',
    previous: [],
  });
  const digest = `sha256:${'a1'.repeat(32)}`;
  const image = { tags: imageTags(info), digest };

  it('lists version, packages and grouped changes', () => {
    const notes = releaseNotes({
      info,
      image,
      packages: [
        {
          name: '@bluepax/cms-client',
          version: '1.0.0-beta.9',
          distTag: 'beta',
          status: 'published',
        },
      ],
      changes: [
        { title: 'CMS and image', body: '#### Features\n\n- **storage:** Add R2 backfill' },
        { title: 'npm: cms-client', body: '' },
      ],
    });
    expect(notes).toContain('- Build: 9');
    expect(notes).toContain(
      '## Image\n\n- `ghcr.io/bluepax/bluepax-cms:1.0.0-beta.9`, also tagged `beta`\n' +
        `- Digest: \`${digest}\``,
    );
    expect(notes.indexOf('## Image')).toBeLessThan(notes.indexOf('## npm packages'));
    expect(notes).toContain(
      '[`@bluepax/cms-client@1.0.0-beta.9`](https://github.com/bluepax/bluepax-cms/pkgs/npm/cms-client), dist-tag `beta`',
    );
    expect(notes).toContain('### npm: cms-client\n\nNo changes, version synced only.');
    expect(notes).toContain('- **storage:** Add R2 backfill');
  });

  it('says so when there are no npm packages', () => {
    expect(releaseNotes({ info, image, packages: [], changes: [] })).toContain(
      'No npm packages in this release.',
    );
  });

  it('refuses a release without a valid image digest', () => {
    expect(() =>
      releaseNotes({ info, image: { ...image, digest: '' }, packages: [], changes: [] }),
    ).toThrow(/image digest/);
  });

  it('builds package page links without the scope', () => {
    expect(packagePageUrl('@bluepax/cms-blocks')).toBe(
      'https://github.com/bluepax/bluepax-cms/pkgs/npm/cms-blocks',
    );
  });
});
