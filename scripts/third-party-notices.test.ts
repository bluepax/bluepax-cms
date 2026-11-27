import { describe, expect, it } from 'vitest';
import { notices } from './third-party-notices.ts';

describe('notices', () => {
  const entries = [
    { name: 'zod', versions: ['4.6.7'], paths: ['/z'], license: 'MIT' },
    { name: '@bluepax/db', versions: ['0.0.0-development'], paths: ['/b'], license: 'MIT' },
    {
      name: '@img/sharp-libvips-linuxmusl-x64',
      versions: ['1.3.4'],
      paths: ['/v'],
      license: 'LGPL-3.0-or-later',
      homepage: 'https://sharp.pixelplumbing.com',
    },
  ];
  const read = (path: string): [string, string][] =>
    path === '/z' ? [['LICENSE', 'MIT License\n\nCopyright …\n']] : [];

  it('lists third-party packages with their license files, sorted, without our own packages', () => {
    const text = notices(entries, read);
    expect(text).not.toContain('@bluepax/db');
    expect(text.indexOf('## @img/sharp-libvips')).toBeLessThan(text.indexOf('## zod@4.6.7'));
    expect(text).toContain('### LICENSE\n\n```text\nMIT License\n\nCopyright …\n```');
  });

  it('points the libvips binaries at the LGPL text shipped next to the notices', () => {
    expect(notices(entries, read)).toContain('`licenses/LGPL-3.0.txt` and `licenses/GPL-3.0.txt`');
  });
});
