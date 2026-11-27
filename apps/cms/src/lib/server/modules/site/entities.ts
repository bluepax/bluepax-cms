// Legal entities and their locations (docs/spec/README.md chapter 4, may be empty).
// Company data is entered in the admin only; it is not part of the config file or a seed.
import { schema, type AddressLines, type Database } from '@bluepax/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { contentLanguages, type Actor } from './settings.ts';
import {
  InvalidInputError,
  localized,
  mergeLocalized,
  optionalEmail,
  parseInput,
  phone,
  requireLanguage,
  sortOrder,
} from './values.ts';

const entitySchema = z.strictObject({
  legalName: localized(300),
  role: localized(100),
  registrationNumber: z.string().trim().max(100),
  registrationNumberPublic: z.boolean(),
  taxId: z.string().trim().max(100),
  taxIdPublic: z.boolean(),
  email: optionalEmail,
  phone,
  sortOrder,
});

const addressLines = z
  .strictObject({
    street: z.string().trim().max(300).optional(),
    locality: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
  })
  .transform((lines) => {
    const result: AddressLines = {};
    for (const key of ['street', 'locality', 'region'] as const) {
      if (lines[key]) result[key] = lines[key];
    }
    return result;
  });

const locationSchema = z
  .strictObject({
    name: localized(200),
    address: z
      .record(z.string(), addressLines)
      .transform((value) =>
        Object.fromEntries(Object.entries(value).filter(([, l]) => Object.keys(l).length > 0)),
      ),
    postalCode: z.string().trim().max(20),
    country: z.union([
      z.literal(''),
      z
        .string()
        .regex(/^[A-Za-z]{2}$/)
        .transform((v) => v.toUpperCase()),
    ]),
    phone,
    email: optionalEmail,
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    openingHours: z.string().trim().max(300),
    sortOrder,
  })
  .refine((l) => (l.latitude === null) === (l.longitude === null), {
    path: ['latitude'],
    message: 'latitude and longitude go together',
  });

export type EntityInput = z.input<typeof entitySchema>;
export type LocationInput = z.input<typeof locationSchema>;

export async function listEntities(db: Database) {
  const entities = await db
    .select()
    .from(schema.legalEntities)
    .orderBy(asc(schema.legalEntities.sortOrder), asc(schema.legalEntities.createdAt));
  const counts = await db
    .select({ entityId: schema.entityLocations.entityId, count: sql<number>`count(*)::int` })
    .from(schema.entityLocations)
    .groupBy(schema.entityLocations.entityId);
  const byEntity = new Map(counts.map((c) => [c.entityId, c.count]));
  return entities.map((e) => ({ ...e, locations: byEntity.get(e.id) ?? 0 }));
}

export async function getEntity(db: Database, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [entity] = await db
    .select()
    .from(schema.legalEntities)
    .where(eq(schema.legalEntities.id, id));
  if (!entity) return null;
  const locations = await db
    .select()
    .from(schema.entityLocations)
    .where(eq(schema.entityLocations.entityId, id))
    .orderBy(asc(schema.entityLocations.sortOrder), asc(schema.entityLocations.createdAt));
  return { ...entity, locations };
}

function notFound(): never {
  throw new InvalidInputError(['not_found'], 'not found');
}

/** Ids come from URLs and forms; anything that is not a UUID cannot exist. */
function checkId(...ids: string[]): void {
  if (!ids.every((id) => z.uuid().safeParse(id).success)) notFound();
}

export async function createEntity(db: Database, input: EntityInput, actor: Actor) {
  const value = parseInput(entitySchema, input);
  return db.transaction(async (tx) => {
    requireLanguage('legalName', value.legalName, (await contentLanguages(tx)).primary);
    const [row] = await tx
      .insert(schema.legalEntities)
      .values(value)
      .returning({ id: schema.legalEntities.id });
    await audit(tx, {
      action: 'site.entity_create',
      actorId: actor.id,
      targetType: 'legal_entity',
      targetId: row!.id,
      ip: actor.ip,
    });
    return row!.id;
  });
}

export async function updateEntity(db: Database, id: string, input: EntityInput, actor: Actor) {
  checkId(id);
  const value = parseInput(entitySchema, input);
  await db.transaction(async (tx) => {
    const { codes, primary } = await contentLanguages(tx);
    requireLanguage('legalName', value.legalName, primary);
    const [before] = await tx
      .select()
      .from(schema.legalEntities)
      .where(eq(schema.legalEntities.id, id))
      .for('update');
    if (!before) notFound();
    await tx
      .update(schema.legalEntities)
      .set({
        ...value,
        legalName: mergeLocalized(before.legalName, value.legalName, codes),
        role: mergeLocalized(before.role, value.role, codes),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.legalEntities.id, id));
    await audit(tx, {
      action: 'site.entity_update',
      actorId: actor.id,
      targetType: 'legal_entity',
      targetId: id,
      ip: actor.ip,
    });
  });
}

/** Deletes the entity with its locations. */
export async function deleteEntity(db: Database, id: string, actor: Actor): Promise<void> {
  checkId(id);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.legalEntities)
      .where(eq(schema.legalEntities.id, id))
      .returning({ legalName: schema.legalEntities.legalName });
    if (removed.length === 0) notFound();
    await audit(tx, {
      action: 'site.entity_delete',
      actorId: actor.id,
      targetType: 'legal_entity',
      targetId: id,
      details: { legalName: removed[0]!.legalName },
      ip: actor.ip,
    });
  });
}

export async function createLocation(
  db: Database,
  entityId: string,
  input: LocationInput,
  actor: Actor,
) {
  checkId(entityId);
  const value = parseInput(locationSchema, input);
  return db.transaction(async (tx) => {
    const [entity] = await tx
      .select({ id: schema.legalEntities.id })
      .from(schema.legalEntities)
      .where(eq(schema.legalEntities.id, entityId));
    if (!entity) notFound();
    const [row] = await tx
      .insert(schema.entityLocations)
      .values({ ...value, entityId })
      .returning({ id: schema.entityLocations.id });
    await audit(tx, {
      action: 'site.location_create',
      actorId: actor.id,
      targetType: 'entity_location',
      targetId: row!.id,
      details: { entityId },
      ip: actor.ip,
    });
    return row!.id;
  });
}

export async function updateLocation(
  db: Database,
  entityId: string,
  id: string,
  input: LocationInput,
  actor: Actor,
) {
  checkId(entityId, id);
  const value = parseInput(locationSchema, input);
  await db.transaction(async (tx) => {
    const { codes } = await contentLanguages(tx);
    const [before] = await tx
      .select()
      .from(schema.entityLocations)
      .where(eq(schema.entityLocations.id, id))
      .for('update');
    if (!before || before.entityId !== entityId) notFound();
    await tx
      .update(schema.entityLocations)
      .set({
        ...value,
        name: mergeLocalized(before.name, value.name, codes),
        address: mergeLocalized<AddressLines>(before.address, value.address, codes),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.entityLocations.id, id));
    await audit(tx, {
      action: 'site.location_update',
      actorId: actor.id,
      targetType: 'entity_location',
      targetId: id,
      details: { entityId },
      ip: actor.ip,
    });
  });
}

export async function deleteLocation(
  db: Database,
  entityId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  checkId(entityId, id);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.entityLocations)
      .where(and(eq(schema.entityLocations.id, id), eq(schema.entityLocations.entityId, entityId)))
      .returning({ id: schema.entityLocations.id });
    if (removed.length === 0) notFound();
    await audit(tx, {
      action: 'site.location_delete',
      actorId: actor.id,
      targetType: 'entity_location',
      targetId: id,
      details: { entityId },
      ip: actor.ip,
    });
  });
}
