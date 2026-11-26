import { describe, expect, it } from 'vitest';
import { buildInfo } from './build-info.ts';

const fixedNow = () => new Date('2026-11-24T00:00:00Z');

describe('buildInfo', () => {
  it('uses the values passed by CI', () => {
    const git = () => {
      throw new Error('git must not be called');
    };
    const env = {
      BLUEPAX_VERSION: '1.0.0-beta.7',
      BLUEPAX_BUILD: '7',
      BLUEPAX_COMMIT: 'abc123',
      BLUEPAX_BUILT_AT: '2026-11-20T10:00:00Z',
    };
    expect(buildInfo(env, git, fixedNow)).toEqual({
      version: '1.0.0-beta.7',
      build: 7,
      commit: 'abc123',
      builtAt: '2026-11-20T10:00:00Z',
    });
  });

  it('falls back to git for local builds', () => {
    const git = (args: string[]) => (args[0] === 'rev-list' ? '42' : 'def456');
    expect(buildInfo({}, git, fixedNow)).toEqual({
      version: '0.0.0-development',
      build: 42,
      commit: 'def456',
      builtAt: '2026-11-24T00:00:00.000Z',
    });
  });

  it('treats empty values like missing ones', () => {
    const git = (args: string[]) => (args[0] === 'rev-list' ? '42' : 'def456');
    const env = {
      BLUEPAX_VERSION: '',
      BLUEPAX_BUILD: '',
      BLUEPAX_COMMIT: '',
      BLUEPAX_BUILT_AT: '',
    };
    expect(buildInfo(env, git, fixedNow)).toEqual({
      version: '0.0.0-development',
      build: 42,
      commit: 'def456',
      builtAt: '2026-11-24T00:00:00.000Z',
    });
  });

  it('still builds outside a git checkout', () => {
    const git = () => {
      throw new Error('not a git repository');
    };
    expect(buildInfo({}, git, fixedNow)).toMatchObject({ build: 0, commit: 'unknown' });
  });

  it('rejects an invalid build number', () => {
    expect(() => buildInfo({ BLUEPAX_BUILD: '1.5' }, () => '', fixedNow)).toThrow(/BLUEPAX_BUILD/);
  });
});
