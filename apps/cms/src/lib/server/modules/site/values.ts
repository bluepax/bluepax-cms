// Value schemas shared by the site settings (docs/spec/README.md chapter 3, `site`).
import { canonicalLocale, ConfigError } from '@bluepax/presets';
import { z } from 'zod';
import type { Localized } from '@bluepax/db';

/** Thrown when submitted settings are invalid; `fields` are form field paths such as `publisher.name`. */
export class InvalidInputError extends Error {
  override name = 'InvalidInputError';
  readonly fields: string[];
  /** Why the fields failed when there is more to say than "invalid", e.g. `not_square_png`. */
  readonly reason: string | undefined;

  constructor(fields: string[], message = `invalid input: ${fields.join(', ')}`, reason?: string) {
    super(message);
    this.fields = [...new Set(fields)];
    this.reason = reason;
  }
}

/** Parses with a Zod schema and turns its issues into an InvalidInputError. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  prefix = '',
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new InvalidInputError(
    result.error.issues.map((issue) => prefix + (issue.path.join('.') || 'form')),
  );
}

/**
 * A ConfigError from a configuration section turned into form fields: `site.publisher.name`
 * becomes `publisher.name` when the form edits the `site` section.
 */
export function configInputError(error: unknown, section: string): never {
  if (!(error instanceof ConfigError)) throw error;
  throw new InvalidInputError(
    error.issues.map((issue) => {
      const path = issue.slice(0, issue.indexOf(':'));
      return path.startsWith(`${section}.`) ? path.slice(section.length + 1) : path;
    }),
    error.message,
  );
}

/** Empty or an e-mail address. */
export const optionalEmail = z.union([z.literal(''), z.email()]);
export const phone = z.string().max(64);
export const sortOrder = z.int().min(-1_000_000).max(1_000_000);

/** A text per content language; empty texts are dropped, keys must be BCP 47 tags. */
export function localized(max: number) {
  return z.record(z.string(), z.string().trim().max(max)).transform((value, ctx) => {
    const result: Localized = {};
    for (const [key, text] of Object.entries(value)) {
      const code = canonicalLocale(key);
      if (!code) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'not a BCP 47 language tag' });
        continue;
      }
      if (text) result[code] = text;
    }
    return result;
  });
}

/**
 * Merges submitted texts into stored ones. The form only shows the current content
 * languages; texts of languages that were removed are kept, so adding the language again
 * brings them back.
 */
export function mergeLocalized<T>(
  stored: Localized<T> | null | undefined,
  submitted: Localized<T>,
  languages: readonly string[],
): Localized<T> {
  const kept = Object.entries(stored ?? {}).filter(([code]) => !languages.includes(code));
  return { ...Object.fromEntries(kept), ...submitted };
}

/** Requires a text in the given language (the primary language). */
export function requireLanguage(field: string, value: Localized, language: string): void {
  if (!value[language]) throw new InvalidInputError([`${field}.${language}`]);
}
