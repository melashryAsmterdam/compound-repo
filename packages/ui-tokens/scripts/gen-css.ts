import { writeFileSync } from 'node:fs';
import { toCss } from '../src/index.ts';

writeFileSync(new URL('../tokens.css', import.meta.url), toCss());
console.log('wrote tokens.css');
