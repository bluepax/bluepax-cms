import { describe, expect, it } from 'vitest';
import { isSlug, SLUG_MAX_LENGTH, slugify } from './slug.ts';

describe('slugs', () => {
  it('accepts lowercase Latin groups joined by single hyphens', () => {
    for (const slug of ['about', 'about-us', 'a1-b2-c3', '2026'])
      expect(isSlug(slug), slug).toBe(true);
    for (const slug of [
      '',
      'About',
      'about_us',
      '-about',
      'about-',
      'a--b',
      'über',
      'a b',
      'a/b',
    ]) {
      expect(isSlug(slug), slug).toBe(false);
    }
    expect(isSlug('a'.repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(isSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });

  it('checks long input without backtracking', () => {
    const start = performance.now();
    expect(isSlug(`${'a-'.repeat(50_000)}!`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('suggests slugs from Latin titles', () => {
    expect(slugify('About Us')).toBe('about-us');
    expect(slugify('  Café & Crème brûlée!  ')).toBe('cafe-creme-brulee');
    expect(slugify('Products — 2026')).toBe('products-2026');
    expect(slugify('关于我们')).toBe('');
    expect(slugify('x'.repeat(300))).toHaveLength(SLUG_MAX_LENGTH);
    expect(isSlug(slugify(`${'ab '.repeat(60)}`))).toBe(true);
  });
});
