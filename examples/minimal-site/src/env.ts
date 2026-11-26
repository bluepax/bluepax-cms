// Environment variables of the example frontend (see .env.example). All of them are private: they
// can only be imported on the server (`$app/env/private`). They are optional at build time and
// checked when the first request needs them.
import { defineEnvVars } from '@sveltejs/kit/env';

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('must be a URL, e.g. https://cms.example.com');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('must be http(s)');
  return value;
}

const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
  BLUEPAX_CMS_URL: {
    description: 'Public URL of the BluePax CMS, e.g. https://cms.example.com (required)',
    schema: httpUrl,
  },
  BLUEPAX_DELIVERY_TOKEN: {
    description: 'Delivery Token (scope delivery:read) from the CMS page "接入与 API" (required)',
    schema: optional,
  },
  BLUEPAX_PREVIEW_SECRET: {
    description: 'Preview secret from "接入与 API"; when set, preview links are checked first',
    schema: optional,
  },
});
