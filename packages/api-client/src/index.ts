import createClient, { type Client, type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];

/**
 * Typed client for the shared API (portal and mobile). The return type is spelled out so the emitted
 * .d.ts keeps `Client<paths>` — inferred, it became `createClient.Client<…>`, which consumers read as
 * untyped (every response `unknown`).
 */
export function createApiClient(options: ClientOptions): Client<paths> {
  return createClient<paths>(options);
}
