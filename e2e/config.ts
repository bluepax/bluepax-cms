// Shared settings of the end-to-end tests (docs/adr/0016). Every value is fictional and only
// lives in the throw-away instance that e2e/serve.ts starts on an empty database.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E = {
  /** The built CMS (apps/cms/build), started by Playwright's webServer. */
  cms: 'http://localhost:4173',
  cmsPort: 4173,
  /** The built example frontend (examples/minimal-site/build), started by the test itself. */
  site: 'http://localhost:4174',
  sitePort: 4174,
  installToken: 'e2e-install-token-not-a-secret',
  /** The instance's backups folder, emptied on every start; tests put backup files there. */
  backupsDir: join(tmpdir(), 'bluepax-e2e-backups'),
  admin: {
    email: 'admin@e2e.example.com',
    name: 'E2E Admin',
    password: 'e2e admin password',
  },
  editor: {
    email: 'editor@e2e.example.com',
    name: 'E2E Editor',
    password: 'e2e editor password',
  },
} as const;
