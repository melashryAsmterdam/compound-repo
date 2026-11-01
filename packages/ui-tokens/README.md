# @compound/ui-tokens

Saha (ساحة) design tokens **v0.1.1** (status in the source file: *proposal awaiting owner approval*).
Source: `saha-ui-tokens-v0.1.1.json`, copied unchanged from the Library (`compound-app/design`).

Consumed from TypeScript source — no build step, so a fresh checkout works (QA-12).

```ts
// React Native / Expo
import { color, space, radius, font, touchTarget } from '@compound/ui-tokens';
const styles = { backgroundColor: color.semantic.primary, padding: space[4], borderRadius: radius.md };
```

```css
/* Web (Next.js portal) */
@import '@compound/ui-tokens/tokens.css'; /* --saha-primary, --saha-status-new-fg, --saha-space-4, … */
```

- `color.status.<new|in_progress|done|closed|cancelled|reopened>` → `{ fg, bg, border? }` for request badges.
- References like `{color.green.600}` are resolved; `source` keeps the raw file shape.
- After changing `src/index.ts`, run `pnpm --filter @compound/ui-tokens gen:css`. A test fails if `tokens.css` or `source` drift from the JSON.

**Known gap in v0.1.1:** the *cancelled* badge (`textFaint` on `neutralBg`) measures 4.42:1, under the file's own 4.5:1 rule. Values are kept as designed; raised with the Designer.
