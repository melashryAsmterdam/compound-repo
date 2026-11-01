# @compound/ui-tokens

Saha (ساحة) design tokens **v0.1.2** (status in the source file: *proposal awaiting owner approval*).
Source: `saha-ui-tokens-v0.1.2.json` (also in the Library, `compound-app/design`). v0.1.2 = Designer's v0.1.1 plus the cancelled-badge contrast fix.

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


**v0.1.2 change:** the *cancelled* badge is now `textFaint` on white with a `line` border (5.02:1). On `neutralBg` it was 4.42:1, below the 4.5:1 rule.
