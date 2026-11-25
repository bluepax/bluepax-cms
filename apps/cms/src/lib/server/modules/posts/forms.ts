// Turns the post, category, tag and author forms into service inputs. Validation happens in the
// services; these helpers only read fields, so they stay free of SvelteKit and are easy to test.
import { seoInput } from '../pages/forms.ts';
import { checked, lines, text } from '../site/forms.ts';
import type { AuthorInput } from './authors.ts';
import { PostError } from './errors.ts';
import type { PostInput } from './posts.ts';
import type { TermInput } from './terms.ts';

function json(form: FormData, name: string, fallback: unknown): unknown {
  const value = text(form, name);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new PostError('invalid', { fields: [name] });
  }
}

/**
 * The post editor: language fields, the SEO panel, the body as JSON, and — only when present in
 * the form — the publication date (users who may publish) and the shared fields as JSON (sent
 * only after the editor changed them).
 */
export function postInput(form: FormData): PostInput {
  return {
    title: text(form, 'title'),
    slug: text(form, 'slug'),
    excerpt: text(form, 'excerpt'),
    body: json(form, 'body', undefined),
    keyTakeaways: lines(form, 'keyTakeaways'),
    seo: seoInput(form),
    ...(form.has('publishedAt') && { publishedAt: text(form, 'publishedAt') || null }),
    ...(form.has('shared') && { shared: json(form, 'shared', undefined) }),
  };
}

/** A category or tag language with the SEO panel; categories also send their order. */
export function termInput(form: FormData): TermInput {
  const order = text(form, 'sortOrder');
  return {
    name: text(form, 'name'),
    slug: text(form, 'slug'),
    description: text(form, 'description'),
    seo: seoInput(form),
    ...(form.has('sortOrder') && { sortOrder: order === '' ? 0 : Number(order) }),
  };
}

/** An author language with the SEO panel and the shared fields. */
export function authorInput(form: FormData): AuthorInput {
  return {
    name: text(form, 'name'),
    slug: text(form, 'slug'),
    jobTitle: text(form, 'jobTitle'),
    bio: text(form, 'bio'),
    seo: seoInput(form),
    avatar: text(form, 'avatar') || null,
    sameAs: lines(form, 'sameAs'),
    publicPage: checked(form, 'publicPage'),
    userId: text(form, 'userId') || null,
  };
}
