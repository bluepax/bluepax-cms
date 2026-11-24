// Environment variables, see docs/spec/README.md chapter 9. Secrets only come from here.
// Secrets are optional at build time and checked at startup (docs/adr/0005).
import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';
import { parseRoles } from './lib/server/roles.ts';

export const variables = defineEnvVars({
  DATABASE_URL: {
    description: 'PostgreSQL connection string (required at runtime)',
    schema: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')
      .optional(),
  },
  APP_SECRET: {
    description: 'Secret for sessions and signatures, at least 32 characters (required at runtime)',
    schema: z.string().min(32, 'must be at least 32 characters').optional(),
  },
  ENCRYPTION_KEY: {
    description: 'Key for encrypting stored credentials: 32 bytes as base64 (required at runtime)',
    schema: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes as base64')
      .optional(),
  },
  BLUEPAX_ROLES: {
    description: 'Roles started by this process: web, worker or both (default web,worker)',
    schema: (value) => parseRoles(value),
  },
  BLUEPAX_MIGRATIONS_DIR: {
    description:
      'Folder with the migration sets; defaults to packages/db/migrations in the repository',
    schema: (value) => value || undefined,
  },
});
