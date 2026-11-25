import { defineModule } from '@bluepax/core';
import { BLOCK_KEYS, MODULE_BLOCKS } from '@bluepax/cms-blocks';

/** Create pages and language versions, edit them, submit them for review. */
export const PAGES_EDIT = 'pages.edit';
/** Publish and take offline, choose the home page. */
export const PAGES_PUBLISH = 'pages.publish';
/** Delete a language version or a whole page. */
export const PAGES_DELETE = 'pages.delete';

const moduleBlocks = new Set<string>(Object.values(MODULE_BLOCKS).flat());

// pages module (chapter 3): block pages per content language, with status, SEO fields and the
// home page. Editors have every content action. Working copies, revisions and scheduled
// publishing follow in M2, the Delivery endpoint `GET /pages/{slug}` with the Delivery API.
export const pagesModule = defineModule({
  id: 'pages',
  version: '1.0.0',
  // Images in blocks and the OG image are media items (docs/adr/0008).
  dependsOn: ['media'],
  migrations: 'pages',
  permissions: [
    { name: PAGES_EDIT, kind: 'content' },
    { name: PAGES_PUBLISH, kind: 'content' },
    { name: PAGES_DELETE, kind: 'content' },
  ],
  menu: [{ label: 'nav_pages', href: '/pages', permission: PAGES_EDIT }],
  // The standard blocks that need no optional module; catalog and regions provide theirs.
  blocks: BLOCK_KEYS.filter((key) => !moduleBlocks.has(key)),
  // TODO(M2): sent once webhooks exist (chapter 6, "Webhook 事件").
  webhookEvents: [
    'content.published',
    'content.unpublished',
    'content.deleted',
    'content.slug_changed',
  ],
});
