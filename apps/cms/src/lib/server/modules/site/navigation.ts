// Navigation and footer menus (docs/spec/README.md chapters 3 and 4). Pages are flat; the
// site hierarchy is expressed by nesting menu items. Items link to a frontend path or URL;
// links to pages and posts by ID come with those modules.
import { schema, type Database, type Executor, type Localized } from '@bluepax/db';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { contentLanguages, type Actor } from './settings.ts';
import {
  InvalidInputError,
  localized,
  mergeLocalized,
  parseInput,
  requireLanguage,
  sortOrder,
} from './values.ts';

export const NAV_MENUS = ['header', 'footer'] as const;
export type NavMenu = (typeof NAV_MENUS)[number];
/** Nesting levels, e.g. header item → submenu → item, or footer column → link. */
export const NAV_MAX_DEPTH = 3;

/** Empty (a heading), a frontend path, an http(s) URL, `mailto:` or `tel:`. */
export function isNavUrl(value: string): boolean {
  if (value === '') return true;
  if (/\s/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const itemSchema = z.strictObject({
  parentId: z.uuid().nullable(),
  label: localized(100),
  url: z.string().trim().max(2000).refine(isNavUrl, 'must be a path, URL, mailto: or tel:'),
  newTab: z.boolean(),
  sortOrder,
});

export type NavItemInput = z.input<typeof itemSchema>;

export interface NavItem {
  id: string;
  menu: string;
  parentId: string | null;
  sortOrder: number;
  label: Localized;
  url: string;
  newTab: boolean;
}

export interface NavNode extends NavItem {
  /** 1 for top-level items. */
  depth: number;
  /** Ids of this item and everything below it, so a form can offer only valid parents. */
  subtree: string[];
}

/** Items in display order: depth first, siblings by sort order (already sorted on input). */
export function navTree(items: readonly NavItem[]): NavNode[] {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, NavItem[]>();
  for (const item of items) {
    const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const result: NavNode[] = [];
  const walk = (parent: string | null, depth: number): string[] => {
    const below: string[] = [];
    for (const item of children.get(parent) ?? []) {
      const node: NavNode = { ...item, depth, subtree: [item.id] };
      result.push(node);
      node.subtree.push(...walk(item.id, depth + 1));
      below.push(...node.subtree);
    }
    return below;
  };
  walk(null, 1);
  return result;
}

async function menuItems(db: Executor, menu: string): Promise<NavItem[]> {
  return db
    .select({
      id: schema.navItems.id,
      menu: schema.navItems.menu,
      parentId: schema.navItems.parentId,
      sortOrder: schema.navItems.sortOrder,
      label: schema.navItems.label,
      url: schema.navItems.url,
      newTab: schema.navItems.newTab,
    })
    .from(schema.navItems)
    .where(eq(schema.navItems.menu, menu))
    .orderBy(asc(schema.navItems.sortOrder), asc(schema.navItems.createdAt));
}

export async function listNav(db: Executor, menu: string): Promise<NavNode[]> {
  return navTree(await menuItems(db, menu));
}

/** Rejects a parent from another menu, a cycle, or nesting deeper than NAV_MAX_DEPTH. */
export function checkPlacement(tree: NavNode[], parentId: string | null, self?: NavNode): void {
  // Levels the item brings along: itself plus its deepest descendant.
  const depths = new Map(tree.map((n) => [n.id, n.depth]));
  const height = self
    ? Math.max(...self.subtree.map((id) => depths.get(id) ?? self.depth)) - self.depth + 1
    : 1;
  let parentDepth = 0;
  if (parentId) {
    const parent = tree.find((n) => n.id === parentId);
    if (!parent || self?.subtree.includes(parentId)) throw new InvalidInputError(['parentId']);
    parentDepth = parent.depth;
  }
  if (parentDepth + height > NAV_MAX_DEPTH) throw new InvalidInputError(['parentId']);
}

function lockMenu(db: Executor, menu: string) {
  return db.execute(sql`select pg_advisory_xact_lock(hashtext(${`bluepax:nav:${menu}`}))`);
}

export async function createNavItem(
  db: Database,
  menu: NavMenu,
  input: NavItemInput,
  actor: Actor,
): Promise<string> {
  if (!NAV_MENUS.includes(menu)) throw new InvalidInputError(['menu']);
  const value = parseInput(itemSchema, input);
  return db.transaction(async (tx) => {
    requireLanguage('label', value.label, (await contentLanguages(tx)).primary);
    await lockMenu(tx, menu);
    checkPlacement(await listNav(tx, menu), value.parentId);
    const [row] = await tx
      .insert(schema.navItems)
      .values({ ...value, menu })
      .returning({ id: schema.navItems.id });
    await audit(tx, {
      action: 'site.nav_create',
      actorId: actor.id,
      targetType: 'nav_item',
      targetId: row!.id,
      details: { menu },
      ip: actor.ip,
    });
    return row!.id;
  });
}

async function findItem(db: Executor, id: string) {
  if (!z.uuid().safeParse(id).success) return undefined;
  const [item] = await db.select().from(schema.navItems).where(eq(schema.navItems.id, id));
  return item;
}

/** Updates an item; it stays in its menu. */
export async function updateNavItem(
  db: Database,
  id: string,
  input: NavItemInput,
  actor: Actor,
): Promise<void> {
  const value = parseInput(itemSchema, input);
  await db.transaction(async (tx) => {
    const { codes, primary } = await contentLanguages(tx);
    requireLanguage('label', value.label, primary);
    const before = await findItem(tx, id);
    if (!before) throw new InvalidInputError(['not_found'], 'not found');
    await lockMenu(tx, before.menu);
    const tree = await listNav(tx, before.menu);
    checkPlacement(
      tree,
      value.parentId,
      tree.find((n) => n.id === id),
    );
    await tx
      .update(schema.navItems)
      .set({
        ...value,
        label: mergeLocalized(before.label, value.label, codes),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.navItems.id, id));
    await audit(tx, {
      action: 'site.nav_update',
      actorId: actor.id,
      targetType: 'nav_item',
      targetId: id,
      details: { menu: before.menu },
      ip: actor.ip,
    });
  });
}

/** Deletes an item and everything nested below it. */
export async function deleteNavItem(db: Database, id: string, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await findItem(tx, id);
    if (!before) throw new InvalidInputError(['not_found'], 'not found');
    await tx.delete(schema.navItems).where(eq(schema.navItems.id, id));
    await audit(tx, {
      action: 'site.nav_delete',
      actorId: actor.id,
      targetType: 'nav_item',
      targetId: id,
      details: { menu: before.menu, label: before.label },
      ip: actor.ip,
    });
  });
}
