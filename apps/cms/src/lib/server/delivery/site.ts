// `GET /site` (docs/spec/README.md chapter 6; docs/adr/0007, 0011, 0012): the site settings in one
// language. Texts per language come in the requested language only (empty when not filled in);
// menu items that point at content carry that content's address in the language, or null when
// it has none there. Sections of modules that are not built yet (catalog types, business types,
// the inquiry form schema, tracking) are added with those modules.
import { schema } from '@bluepax/db';
import { asc, max } from 'drizzle-orm';
import { addressesOf, type RoutableType } from '../content/routes.ts';
import { UPLOADS_PATH } from '../modules/media/files.ts';
import { listNav, type NavNode } from '../modules/site/navigation.ts';
import { readSiteData } from '../modules/site/settings.ts';
import type { NavItem, Site } from './contract.ts';
import { requestLocale, type DeliveryContext } from './context.ts';
import { absoluteMediaUrl } from './media.ts';
import { resolvePublisher } from './seo.ts';

type NavTarget = NonNullable<NavItem['target']>;

function targetOf(item: NavNode): NavTarget | null {
  if (item.pageId) return { type: 'page', id: item.pageId };
  if (item.postId) return { type: 'post', id: item.postId };
  if (item.postCategoryId) return { type: 'postCategory', id: item.postCategoryId };
  return null;
}

async function navigation(ctx: DeliveryContext, locale: string, menu: 'header' | 'footer') {
  const nodes = await listNav(ctx.db, menu);
  const ids = (type: RoutableType) =>
    nodes.flatMap((n) => {
      const target = targetOf(n);
      return target?.type === type ? [target.id] : [];
    });
  const addresses = {
    page: await addressesOf(ctx.db, ctx.routing, 'page', ids('page')),
    post: await addressesOf(ctx.db, ctx.routing, 'post', ids('post')),
    postCategory: await addressesOf(ctx.db, ctx.routing, 'postCategory', ids('postCategory')),
  };
  const items = new Map<string, NavItem>();
  const roots: NavItem[] = [];
  // navTree lists parents before their children.
  for (const node of nodes) {
    const target = targetOf(node);
    const item: NavItem = {
      id: node.id,
      label: node.label[locale] ?? '',
      href: target ? (addresses[target.type].get(target.id)?.[locale] ?? null) : node.url || null,
      newTab: node.newTab,
      target,
      children: [],
    };
    items.set(node.id, item);
    const parent = node.parentId ? items.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  return roots;
}

async function legalEntities(ctx: DeliveryContext, locale: string): Promise<Site['legalEntities']> {
  const entities = await ctx.db
    .select()
    .from(schema.legalEntities)
    .orderBy(asc(schema.legalEntities.sortOrder), asc(schema.legalEntities.createdAt));
  const locations = await ctx.db
    .select()
    .from(schema.entityLocations)
    .orderBy(asc(schema.entityLocations.sortOrder), asc(schema.entityLocations.createdAt));
  return entities.map((e) => ({
    id: e.id,
    legalName: e.legalName[locale] ?? '',
    role: e.role[locale] ?? '',
    registrationNumber:
      e.registrationNumberPublic && e.registrationNumber ? e.registrationNumber : null,
    taxId: e.taxIdPublic && e.taxId ? e.taxId : null,
    email: e.email,
    phone: e.phone,
    locations: locations
      .filter((l) => l.entityId === e.id)
      .map((l) => {
        const address = l.address[locale] ?? {};
        return {
          id: l.id,
          name: l.name[locale] ?? '',
          address: {
            street: address.street ?? '',
            locality: address.locality ?? '',
            region: address.region ?? '',
          },
          postalCode: l.postalCode,
          country: l.country,
          phone: l.phone,
          email: l.email,
          latitude: l.latitude,
          longitude: l.longitude,
          openingHours: l.openingHours,
        };
      }),
  }));
}

export async function getSite(ctx: DeliveryContext, params: URLSearchParams) {
  const locale = requestLocale(ctx, params.get('locale'));
  const { config } = ctx;
  const [contact, social, footer, branding] = await Promise.all([
    readSiteData(ctx.db, 'site.contact'),
    readSiteData(ctx.db, 'site.social'),
    readSiteData(ctx.db, 'site.footer'),
    readSiteData(ctx.db, 'site.branding'),
  ]);
  const im = config.site.im;
  const body: Site = {
    type: config.site.type,
    name: config.site.name,
    locale,
    timezone: config.site.timezone,
    languages: { content: config.languages.content, primary: config.languages.primary },
    publisher: await resolvePublisher(ctx, locale),
    legalEntities: await legalEntities(ctx, locale),
    contact,
    social: social.links,
    im: im ? { channel: im.channel, number: im.number, text: im.text[locale] ?? '' } : null,
    navigation: {
      header: await navigation(ctx, locale, 'header'),
      footer: await navigation(ctx, locale, 'footer'),
    },
    footer: { text: footer.text[locale] ?? '' },
    branding: {
      logo: await ctx.media.one(branding.logo),
      icon: await ctx.media.one(branding.icon),
      themeColor: branding.themeColor,
    },
    modules: [...ctx.active].sort(),
    frontend: {
      baseUrl: config.frontend.baseUrl,
      routes: { ...config.frontend.routes },
      reservedSlugs: config.frontend.reservedSlugs,
    },
    mediaOrigin: { driver: ctx.storage.name, baseUrl: absoluteMediaUrl(ctx.origin, UPLOADS_PATH) },
  };
  const [settings] = await ctx.db
    .select({ latest: max(schema.settings.updatedAt) })
    .from(schema.settings);
  return { body, lastModified: settings?.latest ?? null };
}
