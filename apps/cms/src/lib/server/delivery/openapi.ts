// The OpenAPI 3.1 document of the Delivery API (docs/spec/README.md chapter 6, docs/adr/0012),
// generated from the operations table and the Zod contract: `GET /api/delivery/v1/openapi.json`.
// Its title is "BluePax CMS" (chapter 1).
import { z } from 'zod';
import { errorSchema } from './contract.ts';
import { OPERATIONS } from './operations.ts';

const ERRORS: Record<string, string> = {
  '400': 'Invalid query, e.g. an unknown locale',
  '401': 'Missing, unknown, revoked or expired Delivery Token',
  '403': 'Origin not allowed, scope missing, or an invalid or expired preview link',
  '404': 'Unknown endpoint, a switched-off module, or nothing published here',
  '429': 'Rate limit reached; see Retry-After',
};

let cached: Record<string, unknown> | undefined;

function idOf(schema: z.ZodType): string {
  const id = z.globalRegistry.get(schema)?.id;
  if (!id) throw new Error('every response schema needs an id');
  return id;
}

export function openApiDocument(): Record<string, unknown> {
  if (cached) return cached;
  // Every contract schema carries `.meta({ id })`, so it becomes a named component.
  void errorSchema;
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    io: 'output',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });
  const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    paths[op.path] ??= {};
    paths[op.path]![op.method.toLowerCase()] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: [op.module],
      parameters: op.params.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        description: p.description,
        schema: p.schema,
      })),
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: ref(idOf(op.response)) } },
        },
        ...(op.cache === 'revalidate' && {
          '304': { description: 'Not modified (If-None-Match)' },
        }),
        ...Object.fromEntries(
          Object.entries(ERRORS).map(([status, description]) => [
            status,
            { description, content: { 'application/json': { schema: ref('Error') } } },
          ]),
        ),
      },
    };
  }
  cached = {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'BluePax CMS',
      version: 'v1',
      description:
        'Delivery API: published content and site settings for the one frontend of this instance. ' +
        'Server-side calls only, with a Delivery Token (`Authorization: Bearer …`).',
    },
    servers: [{ url: '/api/delivery/v1' }],
    security: [{ deliveryToken: [] }],
    paths,
    components: {
      securitySchemes: {
        deliveryToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Delivery Token from the "接入与 API" page (scope delivery:read)',
        },
      },
      schemas,
    },
  };
  return cached;
}
