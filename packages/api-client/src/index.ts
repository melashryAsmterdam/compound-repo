// Generated types live in schema.d.ts (never hand-edited; `pnpm gen` rewrites it from the contract).
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };
export type Schemas = components['schemas'];

export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}
