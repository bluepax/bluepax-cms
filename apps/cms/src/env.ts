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
  BLUEPAX_INSTALL_TOKEN: {
    description:
      'One-time install token the setup wizard asks for, at least 16 characters (chapter 2)',
    schema: z.string().min(16, 'must be at least 16 characters').optional(),
  },
  BLUEPAX_CONFIG_FILE: {
    description:
      'Instance config (YAML) that initialises an empty instance unattended at startup (chapter 2)',
    schema: (value) => value || undefined,
  },
  BLUEPAX_ROLES: {
    description: 'Roles started by this process: web, worker or both (default web,worker)',
    schema: (value) => parseRoles(value),
  },
  BLUEPAX_UPLOADS_DIR: {
    description:
      'Root folder of the local media storage (chapter 5); defaults to /data/uploads, the uploads volume',
    schema: (value) => value || undefined,
  },
  BLUEPAX_BACKUPS_DIR: {
    description:
      'Folder for database backups (chapter 9); defaults to /data/backups, the backups volume. ' +
      'Without it `vite dev` migrates without a backup',
    schema: (value) => value || undefined,
  },
  // Read by adapter-node itself; declared here so startup can check them (docs/adr/0015).
  ORIGIN: {
    description:
      'Public URL of the CMS, e.g. https://cms.example.com (required in production): media URLs ' +
      'and the CSRF check use it',
    schema: (value) => value || undefined,
  },
  BODY_SIZE_LIMIT: {
    description:
      'Largest request body adapter-node accepts, e.g. 256M (the image default); must exceed ' +
      'the largest upload limit',
    schema: (value) => value || undefined,
  },
  BLUEPAX_MIGRATIONS_DIR: {
    description:
      'Folder with the migration sets; defaults to packages/db/migrations in the repository',
    schema: (value) => value || undefined,
  },
});
