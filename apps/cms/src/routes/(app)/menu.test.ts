// Chapter 3 and 12: the default editor role holds content permissions only. Its admin menu
// (manifests filtered by permission, as the (app) layout builds it) shows the content modules
// and never settings, tokens ("接入与 API") or users; storage settings are not a menu item.
import { describe, expect, it } from 'vitest';
import { registry } from '#lib/server/modules.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { defaultEditor } from '#lib/server/testing.ts';

describe('default editor role', () => {
  const editor = defaultEditor();

  it('holds the content permissions of the core modules and nothing else', () => {
    expect([...editor.permissions]).toEqual([
      'media.edit',
      'pages.delete',
      'pages.edit',
      'pages.publish',
      'posts.authors',
      'posts.delete',
      'posts.edit',
      'posts.publish',
      'posts.taxonomy',
    ]);
    for (const module of registry.all()) {
      for (const p of module.permissions ?? []) {
        if (p.kind === 'settings') expect(can(editor, p.name), p.name).toBe(false);
      }
    }
  });

  it('sees only the content modules in the menu', () => {
    const menu = registry
      .all()
      .flatMap((m) => m.menu ?? [])
      .filter((item) => can(editor, item.permission))
      .map((item) => item.href);
    expect(menu).toEqual(['/media', '/pages', '/posts']);
  });
});
