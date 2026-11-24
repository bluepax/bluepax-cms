// Setup wizard (docs/spec/README.md chapter 2): shown on first visit while there is no admin,
// closed for good afterwards. After an unattended start from a config file it only creates
// the first admin.
import { timingSafeEqual } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { BLUEPAX_INSTALL_TOKEN } from '$app/env/private';
import { ConfigError, configFromPreset, SITE_TYPES, type SiteType } from '@bluepax/presets';
import { getLocale } from '#lib/paraglide/runtime.js';
import { audit } from '#lib/server/audit.ts';
import { parseLocale } from '#lib/server/forms.ts';
import { field, secretField } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import {
  AlreadyInitializedError,
  createInitialAdmin,
  initializeInstance,
  instanceState,
} from '#lib/server/instance.ts';
import { registry } from '#lib/server/modules.ts';
import { AccountError } from '#lib/server/modules/users/accounts.ts';
import { setupLimiter } from '#lib/server/modules/users/limits.ts';
import { getDatabase, isReady } from '#lib/server/runtime.ts';
import { signIn } from '#lib/server/sign-in.ts';
import type { Actions, PageServerLoad } from './$types';

function tokenMatches(given: string): boolean {
  if (!BLUEPAX_INSTALL_TOKEN) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(BLUEPAX_INSTALL_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Config problems mapped to the form field they belong to. */
function configErrors(issues: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.slice(0, issue.indexOf(':'));
    const key = path.startsWith('site.name')
      ? 'name'
      : path.startsWith('frontend.baseUrl')
        ? 'frontendBaseUrl'
        : path.startsWith('languages.primary')
          ? 'primaryLanguage'
          : path.startsWith('languages.content')
            ? 'contentLanguages'
            : 'form';
    fields[key] ??= issue;
  }
  return fields;
}

export const load: PageServerLoad = async () => {
  if (await isReady()) redirect(303, '/');
  const state = await instanceState(getDatabase());
  const locale = getLocale() === 'zh' ? 'zh' : 'en';
  return {
    mode: state.initialized ? ('admin' as const) : ('full' as const),
    tokenConfigured: Boolean(BLUEPAX_INSTALL_TOKEN),
    defaults: {
      adminLocale: locale,
      contentLanguages: locale === 'zh' ? 'zh-CN, en' : 'en',
      primaryLanguage: locale === 'zh' ? 'zh-CN' : 'en',
    },
  };
};

export const actions: Actions = {
  default: async (event) => {
    if (await isReady()) error(404);
    const limit = setupLimiter.hit(clientIp(event) ?? 'unknown');
    if (!limit.allowed) return fail(429, { error: 'rate_limited' });

    const form = await event.request.formData();
    const values = {
      type: (SITE_TYPES as readonly string[]).includes(field(form, 'type'))
        ? (field(form, 'type') as SiteType)
        : 'corporate',
      name: field(form, 'name'),
      frontendBaseUrl: field(form, 'frontendBaseUrl'),
      contentLanguages: field(form, 'contentLanguages'),
      primaryLanguage: field(form, 'primaryLanguage'),
      adminLocale: parseLocale(field(form, 'adminLocale')),
      adminEmail: field(form, 'adminEmail'),
      adminName: field(form, 'adminName'),
    };
    if (!BLUEPAX_INSTALL_TOKEN) return fail(503, { error: 'install_token_missing', values });
    if (!tokenMatches(secretField(form, 'token'))) {
      await audit(getDatabase(), { action: 'instance.setup_token_failed', ip: clientIp(event) });
      return fail(403, { error: 'install_token', values });
    }

    const db = getDatabase();
    const admin = {
      email: values.adminEmail,
      displayName: values.adminName,
      password: secretField(form, 'adminPassword'),
      locale: values.adminLocale,
    };
    let adminId: string | null;
    try {
      if ((await instanceState(db)).initialized) {
        adminId = await createInitialAdmin(db, admin);
      } else {
        const config = configFromPreset({
          type: values.type,
          name: values.name,
          frontendBaseUrl: values.frontendBaseUrl,
          contentLanguages: values.contentLanguages.split(/[\s,，]+/).filter(Boolean),
          primaryLanguage: values.primaryLanguage,
          adminLocale: values.adminLocale,
        });
        ({ adminId } = await initializeInstance(db, config, { registry, source: 'wizard', admin }));
      }
    } catch (err) {
      if (err instanceof ConfigError)
        return fail(400, { fields: configErrors(err.issues), values });
      if (err instanceof AccountError) return fail(400, { error: err.code, values });
      if (err instanceof AlreadyInitializedError) redirect(303, '/login');
      throw err;
    }

    await audit(db, {
      action: 'instance.initialize',
      actorId: adminId,
      details: { type: values.type },
      ip: clientIp(event),
    });
    if (adminId) await signIn(event, adminId);
    redirect(303, '/');
  },
};
