import type { KnownBlock, Media, Site } from '@bluepax/cms-client';

/** A delivered block of one standard type, its `data` typed by `@bluepax/cms-blocks`. */
export type BlockOf<K extends KnownBlock['type']> = Extract<KnownBlock, { type: K }>;

/** What every block component needs besides its block. */
export interface BlockContext {
  /** Media used by the page's blocks, by ID (the page's `media`). */
  media: Record<string, Media>;
  site: Site;
  locale: string;
}

export function mediaOf(ctx: BlockContext, id: string | null | undefined): Media | null {
  return id ? (ctx.media[id] ?? null) : null;
}
