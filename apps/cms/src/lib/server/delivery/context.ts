// What every Delivery handler works with (docs/adr/0012): the database, the storage, the CMS's
// public origin for absolute media URLs, the instance configuration and the active modules,
// read once per request.
import type { ModuleId, ModuleRegistry } from '@bluepax/core';
import type { Database } from '@bluepax/db';
import { canonicalLocale, type InstanceConfig } from '@bluepax/presets';
import type { StorageDriver } from '@bluepax/storage';
import { routingSetup, type RoutingSetup } from '../content/routes.ts';
import { activeModules, exportInstanceConfig } from '../instance.ts';
import { MediaLoader } from './media.ts';

/** An error answered as `{ error: { code, message, details } }` (chapter 6). */
export class DeliveryError extends Error {
  override name = 'DeliveryError';
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'content') =>
  new DeliveryError(404, 'not_found', `No published ${what} here`);

export interface DeliveryContext {
  db: Database;
  storage: StorageDriver;
  /** The CMS's public origin, e.g. `https://cms.example.com` (adapter-node's ORIGIN). */
  origin: string;
  config: InstanceConfig;
  routing: RoutingSetup;
  registry: ModuleRegistry;
  active: ReadonlySet<ModuleId>;
  media: MediaLoader;
  now: Date;
  /** The preview secret, read only when a preview is asked for. */
  previewSecret?: () => Promise<string | null>;
}

export async function deliveryContext(options: {
  db: Database;
  storage: StorageDriver;
  origin: string;
  registry: ModuleRegistry;
  now?: Date;
  previewSecret?: () => Promise<string | null>;
}): Promise<DeliveryContext> {
  const { db, storage, origin, registry, previewSecret } = options;
  const config = await exportInstanceConfig(db);
  return {
    db,
    storage,
    origin,
    config,
    routing: routingSetup(config),
    registry,
    active: await activeModules(db, registry),
    media: new MediaLoader(db, storage, origin),
    now: options.now ?? new Date(),
    ...(previewSecret && { previewSecret }),
  };
}

/** `locale` of a request: a content language in any case (`zh-cn`), the primary one if left out. */
export function requestLocale(ctx: DeliveryContext, value: string | null): string {
  if (value === null || value === '') return ctx.routing.primary;
  const canonical = canonicalLocale(value);
  const found = ctx.routing.languages.find((code) => code === canonical);
  if (!found) {
    throw new DeliveryError(400, 'invalid_locale', 'locale must be a content language', {
      languages: ctx.routing.languages,
    });
  }
  return found;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

function integerParam(params: URLSearchParams, name: string, fallback: number, max: number) {
  const value = params.get(name);
  if (value === null || value === '') return fallback;
  const number = /^\d{1,6}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new DeliveryError(400, 'invalid_query', `${name} must be an integer from 1 to ${max}`, {
      parameter: name,
    });
  }
  return number;
}

/** `page` / `pageSize` (chapter 6: default 20, at most 100). */
export function pagination(params: URLSearchParams): Pagination {
  const page = integerParam(params, 'page', 1, MAX_PAGE);
  const pageSize = integerParam(params, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** A slug filter or path parameter; anything that is not a slug cannot exist. */
export function slugParam(value: string | null): string | null {
  if (value === null || value === '') return null;
  return value.length <= 200 ? value : null;
}

export function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
