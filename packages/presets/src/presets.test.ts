import { describe, expect, it } from 'vitest';
import {
  BLOCK_KEYS,
  ConfigError,
  configFromPreset,
  parseConfigYaml,
  stringifyConfig,
  textDirection,
  validateConfig,
} from './index.ts';

const answers = {
  name: 'Example Site',
  contentLanguages: ['zh-hans', 'en', 'ar'],
  primaryLanguage: 'zh-Hans',
  adminLocale: 'zh' as const,
  frontendBaseUrl: 'https://www.example.com/',
};

describe('presets', () => {
  it('turns on the corporate modules and all 13 blocks', () => {
    const config = configFromPreset({ ...answers, type: 'corporate' });
    expect(config.modules.enabled).toEqual([
      'ai',
      'catalog',
      'inquiries',
      'insights',
      'regions',
      'tracking',
    ]);
    expect(config.blocks.available).toEqual([...BLOCK_KEYS]);
    expect(config.site.publisher.type).toBe('organization');
  });

  it('gives a blog blocks 1–6, 9 and 11–13 and a person as publisher', () => {
    const config = configFromPreset({ ...answers, type: 'blog' });
    expect(config.modules.enabled).toEqual(['ai', 'insights', 'tracking']);
    expect(config.blocks.available).toEqual([
      'hero',
      'text-media',
      'cards',
      'steps',
      'stats',
      'logos',
      'featured-posts',
      'latest-posts',
      'contact-cta',
      'rich-text',
    ]);
    expect(config.site.publisher.type).toBe('person');
  });

  it('normalises languages, directions and the base URL', () => {
    const config = configFromPreset({ ...answers, type: 'blog' });
    expect(config.languages.content).toEqual([
      { code: 'zh-Hans', dir: 'ltr' },
      { code: 'en', dir: 'ltr' },
      { code: 'ar', dir: 'rtl' },
    ]);
    expect(config.languages.primary).toBe('zh-Hans');
    expect(config.frontend.baseUrl).toBe('https://www.example.com');
    expect(config.site.timezone).toBe('UTC');
    expect(textDirection('he')).toBe('rtl');
  });
});

describe('instance config', () => {
  const valid = configFromPreset({ ...answers, type: 'corporate' });

  it('round-trips through YAML', () => {
    const yaml = stringifyConfig(valid);
    expect(yaml.startsWith('# BluePax CMS instance configuration')).toBe(true);
    expect(parseConfigYaml(yaml)).toEqual(valid);
  });

  it('reports every problem with its path', () => {
    try {
      validateConfig({
        ...valid,
        site: { ...valid.site, timezone: 'Mars/Base' },
        languages: { ...valid.languages, primary: 'fr' },
        modules: { enabled: ['shop'] },
        frontend: { baseUrl: 'ftp://example.com' },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('site.timezone');
      expect(issues).toContain('modules.enabled.0');
      expect(issues).toContain('frontend.baseUrl');
    }
  });

  it('requires the primary language to be a content language', () => {
    expect(() =>
      validateConfig({ ...valid, languages: { ...valid.languages, primary: 'fr' } }),
    ).toThrow(/languages.primary/);
  });

  it('fills the site fields that older config files do not have', () => {
    const config = validateConfig({
      ...valid,
      site: { type: 'blog', name: 'Old File', publisher: { type: 'person' } },
    });
    expect(config.site).toEqual({
      type: 'blog',
      name: 'Old File',
      timezone: 'UTC',
      publisher: { type: 'person', name: '', sameAs: [] },
      brandTerms: [],
      im: null,
    });
  });

  it('keeps instant messaging texts for content languages only, in language order', () => {
    const site = {
      ...valid.site,
      brandTerms: ['Example', 'Example', 'Ex'],
      publisher: {
        type: 'organization' as const,
        name: 'Example Ltd',
        sameAs: ['https://social.example.com/a', 'https://social.example.com/a'],
      },
      im: {
        channel: 'whatsapp',
        number: ' +15550100 ',
        text: { ar: 'مرحبا', 'zh-hans': '你好', en: '' },
      },
    };
    const config = validateConfig({ ...valid, site });
    expect(config.site.im).toEqual({
      channel: 'whatsapp',
      number: '+15550100',
      text: { 'zh-Hans': '你好', ar: 'مرحبا' },
    });
    expect(config.site.brandTerms).toEqual(['Example', 'Ex']);
    expect(config.site.publisher.sameAs).toEqual(['https://social.example.com/a']);

    expect(() =>
      validateConfig({ ...valid, site: { ...site, im: { ...site.im, text: { fr: 'Bonjour' } } } }),
    ).toThrow(/site.im.text.fr/);
    expect(() =>
      validateConfig({ ...valid, site: { ...site, im: { ...site.im, channel: 'What App' } } }),
    ).toThrow(/site.im.channel/);
    expect(() =>
      validateConfig({
        ...valid,
        site: { ...site, publisher: { ...site.publisher, sameAs: ['javascript:alert(1)'] } },
      }),
    ).toThrow(/site.publisher.sameAs.0/);
  });

  it('rejects unknown keys and broken YAML', () => {
    expect(() => validateConfig({ ...valid, extra: true })).toThrow(ConfigError);
    expect(() => parseConfigYaml('site: [')).toThrow(/YAML/);
  });
});

describe('example configs', () => {
  it('stay valid and match their presets', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const type of ['corporate', 'blog'] as const) {
      const file = new URL(`../../../examples/config/${type}.yaml`, import.meta.url);
      const config = parseConfigYaml(await readFile(file, 'utf8'));
      expect(config.site.type).toBe(type);
      expect(config.modules.enabled).toEqual(
        configFromPreset({ ...answers, type }).modules.enabled,
      );
      expect(config.blocks.available).toEqual(
        configFromPreset({ ...answers, type }).blocks.available,
      );
      // The YAML written by an export reads back to the same configuration.
      expect(parseConfigYaml(stringifyConfig(config))).toEqual(config);
    }
  });
});
