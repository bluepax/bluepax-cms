// Runs the real commitlint CLI against the repository config.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lint = (message: string): number =>
  spawnSync('pnpm', ['exec', 'commitlint'], { input: message, encoding: 'utf8' }).status ?? -1;

const signOff = 'Signed-off-by: Jane Doe <jane@example.com>';

describe('commit message rules', () => {
  it('accepts a conventional, signed-off commit', () => {
    expect(lint(`feat(storage): add r2 backfill #42\n\n${signOff}\n`)).toBe(0);
  });

  it('rejects a commit without sign-off, an unknown scope or a sentence-case subject', () => {
    expect(lint('feat(storage): add r2 backfill\n')).not.toBe(0);
    expect(lint(`feat(shop): add cart\n\n${signOff}\n`)).not.toBe(0);
    expect(lint(`feat: Add cart\n\n${signOff}\n`)).not.toBe(0);
  });

  it('skips commits made by Dependabot', () => {
    const message = readFileSync(
      new URL('fixtures/dependabot-commit.txt', import.meta.url),
      'utf8',
    );
    expect(lint(message)).toBe(0);
  });

  it('skips the release commit on main, whose codename stands in the type position', () => {
    const release = [
      'swift(v1.0.0-beta.34): release the m1 skeleton as the first beta',
      '',
      '<feature>',
      'Add the module registry',
      '',
    ].join('\n');
    expect(lint(release)).toBe(0);
    expect(lint('swift(v1.2.0): add the insights dashboards\n')).toBe(0);
  });

  it('still checks commits that only look like a release commit', () => {
    expect(lint('feat(v1.0.0): add cart\n')).not.toBe(0);
    expect(lint('Swift(v1.0.0): add cart\n')).not.toBe(0);
    expect(lint('swift(1.0.0): add cart\n')).not.toBe(0);
    expect(lint('swift(v1.0.0-rc.1): add cart\n')).not.toBe(0);
  });

  it('does not skip a commit that only copies the Dependabot sign-off', () => {
    expect(
      lint('feat: Add cart\n\nSigned-off-by: dependabot[bot] <support@github.com>\n'),
    ).not.toBe(0);
  });
});
