import type { Media } from '@bluepax/cms-client';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, htmlLang, pageParam } from './format.ts';
import { languageName, messages } from './i18n.ts';
import { imHref, isLocalPath, safeHref } from './links.ts';
import { altOf, srcsetOf, variantUrl } from './media.ts';

const CMS = 'http://cms.example.test';

describe('links', () => {
  it('keeps only the link targets the CMS allows', () => {
    expect(safeHref('/en/about')).toBe('/en/about');
    expect(safeHref('https://example.test/x')).toBe('https://example.test/x');
    expect(safeHref('mailto:hello@example.test')).toBe('mailto:hello@example.test');
    expect(safeHref('tel:+10000000')).toBe('tel:+10000000');
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      '//evil.test',
      '/\\evil',
      'data:x',
      '',
      null,
    ]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
  });

  it('follows 301s to own paths only', () => {
    expect(isLocalPath('/en')).toBe(true);
    expect(isLocalPath('//evil.test')).toBe(false);
    expect(isLocalPath('https://evil.test')).toBe(false);
  });

  it('links WhatsApp and Telegram numbers', () => {
    expect(imHref({ channel: 'whatsapp', number: '+1 (000) 000-0000', text: 'Hi & bye' })).toBe(
      'https://wa.me/10000000000?text=Hi%20%26%20bye',
    );
    expect(imHref({ channel: 'telegram', number: '+10000000', text: '' })).toBe(
      'https://t.me/+10000000',
    );
    expect(imHref({ channel: 'wechat', number: 'abc', text: '' })).toBeNull();
  });
});

describe('media', () => {
  const media: Media = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'image',
    mimeType: 'image/jpeg',
    url: `${CMS}/uploads/a.jpg`,
    width: 2000,
    height: 1000,
    size: 1,
    alt: { en: 'A field' },
    variants: [
      {
        name: 'w960',
        url: `${CMS}/uploads/a-960.webp`,
        contentType: 'image/webp',
        width: 960,
        height: 480,
      },
      {
        name: 'w480',
        url: `${CMS}/uploads/a-480.webp`,
        contentType: 'image/webp',
        width: 480,
        height: 240,
      },
      {
        name: 'w480',
        url: `${CMS}/uploads/a-480.avif`,
        contentType: 'image/avif',
        width: 480,
        height: 240,
      },
      {
        name: 'og',
        url: `${CMS}/uploads/a-og.jpg`,
        contentType: 'image/jpeg',
        width: 1200,
        height: 630,
      },
    ],
  };

  it('builds srcset from the WebP width variants', () => {
    expect(srcsetOf(media)).toBe(`${CMS}/uploads/a-480.webp 480w, ${CMS}/uploads/a-960.webp 960w`);
    expect(variantUrl(media, 'og')).toBe(`${CMS}/uploads/a-og.jpg`);
    expect(variantUrl(null, 'og')).toBeNull();
    expect(altOf(media, 'en')).toBe('A field');
    expect(altOf(media, 'zh-CN')).toBe('');
  });
});

describe('format', () => {
  it('reads ?page= strictly', () => {
    const page = (search: string) => pageParam(new URL(`http://site.test/en/blog${search}`));
    expect(page('')).toBe(1);
    expect(page('?page=3')).toBe(3);
    for (const bad of [
      '?page=0',
      '?page=-1',
      '?page=1.5',
      '?page=abc',
      '?page=',
      '?page=10001',
      '?page=999999',
    ]) {
      expect(page(bad), bad).toBeNull();
    }
  });

  it('writes only safe language tags into the page', () => {
    expect(htmlLang('zh-CN')).toBe('zh-CN');
    expect(htmlLang('"><script>')).toBe('en');
    expect(htmlLang(undefined)).toBe('en');
  });

  it('formats dates in the site time zone', () => {
    expect(formatDate('2026-11-25T23:30:00Z', 'en', 'Asia/Shanghai')).toBe('November 26, 2026');
    expect(formatDate('2026-11-25T23:30:00Z', 'en', 'Not/AZone')).toBe('November 25, 2026');
    expect(formatDateTime('2026-11-25T23:30:00Z', 'en', 'Asia/Shanghai')).toBe(
      'Nov 26, 2026, 7:30:00 AM GMT+8',
    );
  });
});

describe('i18n', () => {
  it('speaks Chinese to zh languages and English otherwise', () => {
    expect(messages('zh-CN').notFound).toBe('页面不存在');
    expect(messages('en').notFound).toBe('Page not found');
    expect(messages(undefined).notFound).toBe('Page not found');
    expect(languageName('en')).toBe('English');
    expect(languageName('!!')).toBe('!!');
  });
});
