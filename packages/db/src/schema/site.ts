// Tables of the site module, see docs/spec/README.md chapters 3 and 4 and docs/adr/0007.
// Texts that differ per content language are JSONB maps keyed by BCP 47 code
// (`{ "zh-CN": "…", "en": "…" }`); languages without a text are left out.
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { pages } from './pages.ts';
import { postCategories, posts } from './posts.ts';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};

/** Text per content language. */
export type Localized<T = string> = Record<string, T>;

/** Street address lines of a location, per content language. */
export interface AddressLines {
  street?: string;
  locality?: string;
  region?: string;
}

/** Legal entities (chapter 4, may be empty): the companies behind the site. */
export const legalEntities = pgTable('legal_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  sortOrder: integer('sort_order').notNull().default(0),
  legalName: jsonb('legal_name').$type<Localized>().notNull().default({}),
  /** What the entity is to the site, e.g. headquarters or subsidiary, as free text. */
  role: jsonb('role').$type<Localized>().notNull().default({}),
  registrationNumber: text('registration_number').notNull().default(''),
  registrationNumberPublic: boolean('registration_number_public').notNull().default(false),
  taxId: text('tax_id').notNull().default(''),
  taxIdPublic: boolean('tax_id_public').notNull().default(false),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  ...timestamps,
});

/** Branch locations of a legal entity. */
export const entityLocations = pgTable(
  'entity_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => legalEntities.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    name: jsonb('name').$type<Localized>().notNull().default({}),
    address: jsonb('address').$type<Localized<AddressLines>>().notNull().default({}),
    postalCode: text('postal_code').notNull().default(''),
    /** ISO 3166-1 alpha-2, e.g. `CN`; empty when unknown. */
    country: text('country').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** schema.org `openingHours` notation, e.g. `Mo-Fr 09:00-18:00`. */
    openingHours: text('opening_hours').notNull().default(''),
    ...timestamps,
  },
  (t) => [index('entity_locations_entity_idx').on(t.entityId, t.sortOrder)],
);

/**
 * Navigation and footer menus. Pages are flat; the hierarchy of the site is expressed
 * here (chapter 4). An item links to a page, a post category, a post or a URL; items with none
 * of these are headings, e.g. footer columns.
 */
export const navItems = pgTable(
  'nav_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `header` or `footer`. */
    menu: text('menu').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => navItems.id, {
      onDelete: 'cascade',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    label: jsonb('label').$type<Localized>().notNull().default({}),
    /** Frontend path (`/en/about`), absolute URL, `mailto:` or `tel:`; empty for a heading. */
    url: text('url').notNull().default(''),
    /** A page instead of a URL; its address per language follows the route templates. */
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'restrict' }),
    /** A post category instead of a URL (docs/adr/0010). */
    postCategoryId: uuid('post_category_id').references(() => postCategories.id, {
      onDelete: 'restrict',
    }),
    /** A post instead of a URL (docs/adr/0010). */
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'restrict' }),
    newTab: boolean('new_tab').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('nav_items_menu_idx').on(t.menu, t.sortOrder),
    index('nav_items_parent_idx').on(t.parentId),
    index('nav_items_page_idx').on(t.pageId),
    index('nav_items_post_category_idx').on(t.postCategoryId),
    index('nav_items_post_idx').on(t.postId),
  ],
);
