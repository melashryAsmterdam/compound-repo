import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];

/** Typed client for the shared API (portal and mobile). */
export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}
