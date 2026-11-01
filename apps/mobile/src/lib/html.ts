/**
 * Minimal, safe rendering of the server's legal HTML as text blocks (no WebView, no script).
 * Headings, paragraphs and list items only — enough for the versioned notice and terms.
 */
export interface Block {
  text: string;
  heading?: boolean;
  bullet?: boolean;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

export function htmlToBlocks(html: string): Block[] {
  const out: Block[] = [];
  const re = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1]!.toLowerCase();
    const text = decode(m[2]!.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    out.push({ text, heading: tag.startsWith('h'), bullet: tag === 'li' });
  }
  if (!out.length) {
    const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text) out.push({ text });
  }
  return out;
}
