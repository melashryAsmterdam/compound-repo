import createClient, { type Client, type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];

/**
 * Typed client for the shared API (portal and mobile). The return type is explicit: inferred, the
 * emitted d.ts names `createClient.Client<…>`, which consumers resolve as untyped (`unknown` bodies).
 */
export function createApiClient(options: ClientOptions): Client<paths> {
  return createClient<paths>(options);
}
