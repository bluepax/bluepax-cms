// Turns the settings forms into service inputs. Validation happens in the services; these
// helpers only read fields, so they stay free of SvelteKit and are easy to test.
import type { Localized } from '@bluepax/db';
import type { EntityInput, LocationInput } from './entities.ts';
import type { NavItemInput } from './navigation.ts';
import type {
  GeneralInput,
  InstantMessagingInput,
  LanguagesInput,
  SmtpPasswordChange,
} from './settings.ts';

export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Every value of a repeated field, trimmed. */
export function all(form: FormData, name: string): string[] {
  return form.getAll(name).map((v) => (typeof v === 'string' ? v.trim() : ''));
}

/** One entry per non-empty line of a textarea. */
export function lines(form: FormData, name: string): string[] {
  return text(form, name)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === 'on';
}

/** Empty is null; anything else must be a number (NaN fails validation). */
export function numberOrNull(form: FormData, name: string): number | null {
  const value = text(form, name);
  return value === '' ? null : Number(value);
}

export function integer(form: FormData, name: string): number {
  const value = text(form, name);
  return value === '' ? 0 : Number(value);
}

/** Fields named `<name>.<language>` for each content language. */
export function localizedText(
  form: FormData,
  name: string,
  languages: readonly string[],
): Localized {
  return Object.fromEntries(languages.map((code) => [code, text(form, `${name}.${code}`)]));
}

export function generalInput(form: FormData): GeneralInput {
  return {
    type: text(form, 'type'),
    name: text(form, 'name'),
    timezone: text(form, 'timezone'),
    publisher: {
      type: text(form, 'publisher.type'),
      name: text(form, 'publisher.name'),
      sameAs: lines(form, 'publisher.sameAs'),
    },
    brandTerms: lines(form, 'brandTerms'),
  };
}

export function instantMessagingInput(
  form: FormData,
  languages: readonly string[],
): InstantMessagingInput {
  return {
    channel: text(form, 'channel'),
    number: text(form, 'number'),
    text: localizedText(form, 'text', languages),
  };
}

export function languagesInput(form: FormData): LanguagesInput {
  const dirs = all(form, 'dir');
  return {
    content: all(form, 'code')
      .map((code, i) => ({ code, dir: dirs[i] }))
      .filter((l) => l.code !== '')
      .map(({ code, dir }) => (dir === 'ltr' || dir === 'rtl' ? { code, dir } : { code })),
    primary: text(form, 'primary'),
    admin: text(form, 'admin'),
  };
}

export function socialInput(form: FormData) {
  const urls = all(form, 'url');
  return {
    links: all(form, 'network')
      .map((network, i) => ({ network, url: urls[i] ?? '' }))
      .filter((l) => l.network !== '' || l.url !== ''),
  };
}

export function smtpInput(form: FormData): { settings: unknown; password: SmtpPasswordChange } {
  const password = form.get('password');
  return {
    settings: {
      host: text(form, 'host'),
      port: integer(form, 'port'),
      security: text(form, 'security'),
      username: text(form, 'username'),
      fromAddress: text(form, 'fromAddress'),
    },
    // Passwords are not trimmed.
    password: {
      set: typeof password === 'string' && password !== '' ? password : undefined,
      clear: checked(form, 'clearPassword'),
    },
  };
}

export function entityInput(form: FormData, languages: readonly string[]): EntityInput {
  return {
    legalName: localizedText(form, 'legalName', languages),
    role: localizedText(form, 'role', languages),
    registrationNumber: text(form, 'registrationNumber'),
    registrationNumberPublic: checked(form, 'registrationNumberPublic'),
    taxId: text(form, 'taxId'),
    taxIdPublic: checked(form, 'taxIdPublic'),
    email: text(form, 'email'),
    phone: text(form, 'phone'),
    sortOrder: integer(form, 'sortOrder'),
  };
}

export function locationInput(form: FormData, languages: readonly string[]): LocationInput {
  return {
    name: localizedText(form, 'name', languages),
    address: Object.fromEntries(
      languages.map((code) => [
        code,
        {
          street: text(form, `street.${code}`),
          locality: text(form, `locality.${code}`),
          region: text(form, `region.${code}`),
        },
      ]),
    ),
    postalCode: text(form, 'postalCode'),
    country: text(form, 'country'),
    phone: text(form, 'phone'),
    email: text(form, 'email'),
    latitude: numberOrNull(form, 'latitude'),
    longitude: numberOrNull(form, 'longitude'),
    openingHours: text(form, 'openingHours'),
    sortOrder: integer(form, 'sortOrder'),
  };
}

export function navItemInput(form: FormData, languages: readonly string[]): NavItemInput {
  return {
    parentId: text(form, 'parentId') || null,
    label: localizedText(form, 'label', languages),
    url: text(form, 'url'),
    newTab: checked(form, 'newTab'),
    sortOrder: integer(form, 'sortOrder'),
  };
}
