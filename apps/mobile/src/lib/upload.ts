import { unwrap, type ResidentApi } from './api';

export type UploadPurpose = 'request_photo' | 'reopen_photo';

/** POST /app/v1/uploads for a signed URL, then PUT the bytes (ADR-013). Returns the uploadId. */
export async function uploadBlob(api: ResidentApi, blob: Blob, purpose: UploadPurpose, contentType: 'image/jpeg' = 'image/jpeg'): Promise<string> {
  const ticket = await unwrap(api.client.POST('/app/v1/uploads', { body: { purpose, contentType, bytes: blob.size } }));
  const put = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: blob });
  if (!put.ok) throw new Error(`upload_failed_${put.status}`);
  return ticket.uploadId;
}
