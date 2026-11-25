// Status of routable content per language (docs/spec/README.md chapter 3, "状态"), shared by
// pages and posts: draft → in review → published; in review → draft; published → offline; a
// draft, a version in review and an offline version can be published directly. Who may make a
// change is checked by the caller.
import type { ContentStatus } from '@bluepax/db';
import { z } from 'zod';

export const STATUS_ACTIONS = ['submit', 'withdraw', 'publish', 'unpublish'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export const TRANSITIONS: Readonly<
  Record<StatusAction, { from: readonly ContentStatus[]; to: ContentStatus }>
> = {
  submit: { from: ['draft', 'unpublished'], to: 'in_review' },
  withdraw: { from: ['in_review'], to: 'draft' },
  publish: { from: ['draft', 'in_review', 'unpublished'], to: 'published' },
  unpublish: { from: ['published'], to: 'unpublished' },
};

export function canTransition(status: ContentStatus, action: StatusAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

/** The Postgres error behind a Drizzle error, if any. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      return {
        code: e.code,
        ...(typeof e.constraint === 'string' && { constraint: e.constraint }),
      };
    }
    current = e.cause;
  }
  return {};
}

export const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
