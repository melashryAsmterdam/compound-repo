/**
 * Deep links → app routes. Accepts both `compound://` (what the API puts in Notification.deepLink and
 * push data today) and `compoundapp://` (screen spec §2.1), plus https activation links `/a/<token>`.
 */
export type LinkTarget =
  | { kind: 'request'; id: string }
  | { kind: 'announcement'; id: string }
  | { kind: 'notifications' }
  | { kind: 'activation'; token: string }
  | { kind: 'unknown' };

export function parseLink(link: string | null | undefined): LinkTarget {
  if (!link) return { kind: 'unknown' };
  const m = link.match(/^(?:compound|compoundapp):\/\/\/?([^?#]*)/i) ?? link.match(/^https?:\/\/[^/]+\/([^?#]*)/i);
  const path = (m?.[1] ?? '').replace(/^\/+|\/+$/g, '');
  const [head, id] = path.split('/');
  if (head === 'requests' && id) return { kind: 'request', id };
  if (head === 'announcements' && id) return { kind: 'announcement', id };
  if (head === 'notifications') return { kind: 'notifications' };
  if (head === 'a' && id && /^[A-Za-z0-9_-]{43}$/.test(id)) return { kind: 'activation', token: id };
  return { kind: 'unknown' };
}

export function hrefFor(t: LinkTarget): string | null {
  switch (t.kind) {
    case 'request':
      return `/requests/${t.id}`;
    case 'announcement':
      return `/announcements/${t.id}`;
    case 'notifications':
      return '/notifications';
    case 'activation':
      return `/a/${t.token}`;
    default:
      return null;
  }
}

/** Android Install Referrer (ADR-009): the Play link carries `referrer=token%3D<token>`. */
export function tokenFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  const params = new URLSearchParams(referrer);
  const t = params.get('token') ?? params.get('invite');
  return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}
