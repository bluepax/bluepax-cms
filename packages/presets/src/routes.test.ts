import { describe, expect, it } from 'vitest';
import { pagePath, routeFixedSegments } from './routes.ts';

describe('route templates', () => {
  it('reserves the fixed segments of the default templates', () => {
    expect(routeFixedSegments()).toEqual(['authors', 'blog', 'category', 'tag']);
  });

  it('builds page addresses, the home page at the language root', () => {
    expect(pagePath('zh-CN', 'about', false)).toBe('/zh-cn/about');
    expect(pagePath('en', 'home', true)).toBe('/en');
  });
});
