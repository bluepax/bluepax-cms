import { defineModule } from '@bluepax/core';

/** Create posts and language versions, edit them, submit them for review. */
export const POSTS_EDIT = 'posts.edit';
/** Publish and take offline, change the publication date. */
export const POSTS_PUBLISH = 'posts.publish';
/** Delete a language version or a whole post. */
export const POSTS_DELETE = 'posts.delete';
/** Create, edit and delete post categories and tags. */
export const POSTS_TAXONOMY = 'posts.taxonomy';
/** Create, edit and delete authors. */
export const POSTS_AUTHORS = 'posts.authors';

// posts module (chapter 3): posts per content language with status and SEO fields, post
// categories, tags and authors (docs/adr/0010). Editors have every content action. Scheduled
// publishing, working copies and revisions follow in M2, `/feed` with `seo` (docs/adr/0012).
export const postsModule = defineModule({
  id: 'posts',
  version: '1.0.0',
  // Covers, avatars, images in the body and OG images are media items (docs/adr/0008).
  dependsOn: ['media'],
  migrations: 'posts',
  permissions: [
    { name: POSTS_EDIT, kind: 'content' },
    { name: POSTS_PUBLISH, kind: 'content' },
    { name: POSTS_DELETE, kind: 'content' },
    { name: POSTS_TAXONOMY, kind: 'content' },
    { name: POSTS_AUTHORS, kind: 'content' },
  ],
  menu: [{ label: 'nav_posts', href: '/posts', permission: POSTS_EDIT }],
  endpoints: [
    { method: 'GET', path: '/delivery/v1/posts' },
    { method: 'GET', path: '/delivery/v1/posts/{slug}' },
    { method: 'GET', path: '/delivery/v1/post-categories' },
    { method: 'GET', path: '/delivery/v1/tags' },
    { method: 'GET', path: '/delivery/v1/authors' },
    { method: 'GET', path: '/delivery/v1/authors/{slug}' },
  ],
  // TODO(M2): sent once webhooks exist (chapter 6, "Webhook 事件").
  webhookEvents: [
    'content.published',
    'content.unpublished',
    'content.deleted',
    'content.slug_changed',
  ],
});
