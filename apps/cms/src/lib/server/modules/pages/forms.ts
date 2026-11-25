// Turns the page editor's form into service inputs. Validation happens in the services; these
// helpers only read fields, so they stay free of SvelteKit and are easy to test.
import { checked, lines, text } from '../site/forms.ts';
import { PageError } from './errors.ts';
import type { ContentInput } from './pages.ts';

/** The SEO panel: fields named `seo.<field>`, keywords one per line. */
export function seoInput(form: FormData) {
  return {
    metaTitle: text(form, 'seo.metaTitle'),
    metaDescription: text(form, 'seo.metaDescription'),
    canonical: text(form, 'seo.canonical'),
    robots: {
      index: checked(form, 'seo.robots.index'),
      follow: checked(form, 'seo.robots.follow'),
    },
    ogTitle: text(form, 'seo.ogTitle'),
    ogDescription: text(form, 'seo.ogDescription'),
    ogImage: text(form, 'seo.ogImage') || null,
    keywords: lines(form, 'seo.keywords'),
    summary: text(form, 'seo.summary'),
  };
}

/** Title, slug, SEO fields and the blocks, which the block editor submits as JSON. */
export function contentInput(form: FormData): ContentInput {
  let blocks: unknown;
  try {
    blocks = JSON.parse(text(form, 'blocks') || '[]');
  } catch {
    throw new PageError('invalid', { fields: ['blocks'] });
  }
  return { title: text(form, 'title'), slug: text(form, 'slug'), seo: seoInput(form), blocks };
}
