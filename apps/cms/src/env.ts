// Environment variables, see docs/spec/README.md chapter 9. Secrets only come from here.
import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';
import { parseRoles } from './lib/server/roles.ts';

export const variables = defineEnvVars({
  DATABASE_URL: {
    // Optional here so `vite build` works without a database; startup fails when it is unset.
    description: 'PostgreSQL connection string (required at runtime)',
    schema: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')
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
