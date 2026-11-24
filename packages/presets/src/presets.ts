// Corporate and blog presets (docs/spec/README.md chapter 2). A preset only decides the
// initial state; afterwards every optional module can be switched on or off.
import type { OptionalModuleId } from '@bluepax/core';
import { BLOCK_KEYS, type BlockKey } from './blocks.ts';
import {
  CONFIG_VERSION,
  validateConfig,
  type AdminLocale,
  type InstanceConfig,
  type SiteType,
} from './config.ts';

export interface Preset {
  type: SiteType;
  optionalModules: readonly OptionalModuleId[];
  blocks: readonly BlockKey[];
  publisher: 'organization' | 'person';
  /** Dashboard cards in order (dashboard module). */
  dashboard: readonly string[];
}

export const PRESETS: Readonly<Record<SiteType, Preset>> = {
  corporate: {
    type: 'corporate',
    optionalModules: ['catalog', 'inquiries', 'regions', 'tracking', 'insights', 'ai'],
    blocks: BLOCK_KEYS,
    publisher: 'organization',
    dashboard: ['pending-drafts', 'new-inquiries', 'search-summary', 'conversion-summary'],
  },
  blog: {
    type: 'blog',
    optionalModules: ['tracking', 'insights', 'ai'],
    // Blocks 1–6, 9 and 11–13.
    blocks: BLOCK_KEYS.filter((_, i) => [1, 2, 3, 4, 5, 6, 9, 11, 12, 13].includes(i + 1)),
    publisher: 'person',
    dashboard: ['pending-drafts', 'recent-posts', 'popular-posts', 'search-summary'],
  },
};

export interface SetupAnswers {
  type: SiteType;
  name: string;
  /** Content languages as BCP 47 tags. */
  contentLanguages: string[];
  primaryLanguage: string;
  adminLocale: AdminLocale;
  frontendBaseUrl: string;
}

/** The configuration a setup wizard run produces: the preset plus the answers. */
export function configFromPreset(answers: SetupAnswers): InstanceConfig {
  const preset = PRESETS[answers.type];
  return validateConfig({
    version: CONFIG_VERSION,
    site: { type: preset.type, name: answers.name, publisher: { type: preset.publisher } },
    languages: {
      content: answers.contentLanguages.map((code) => ({ code })),
      primary: answers.primaryLanguage,
      admin: answers.adminLocale,
    },
    frontend: { baseUrl: answers.frontendBaseUrl },
    modules: { enabled: [...preset.optionalModules] },
    blocks: { available: [...preset.blocks] },
    storage: { mode: 'local' },
  });
}
