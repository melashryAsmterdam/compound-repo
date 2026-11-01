'use client';

import { useState } from 'react';

export function CopyLink({ link, label, done }: { link: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rounded-md border border-line bg-surface px-4 py-2 text-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(link).catch(() => undefined);
        setCopied(true);
      }}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
