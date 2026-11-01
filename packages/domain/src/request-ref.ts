/** Human request reference shown to admins and residents: 123 → REQ-00123. */
export function formatRequestRef(refNo: number): string {
  return `REQ-${String(refNo).padStart(5, '0')}`;
}

/** Accepts "REQ-00123", "req123", "123" → 123; anything else → null. */
export function parseRequestRef(input: string): number | null {
  const m = /^\s*(?:req-?)?0*(\d{1,9})\s*$/i.exec(input);
  return m ? Number(m[1]) : null;
}
