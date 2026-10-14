
//
// src/core must not depend on TREB, so it can be lifted out into its own
// package. fails if anything in core imports from ../treb, the package
// root, or @trebco.
//

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', 'src', 'core');
const pattern = /(?:from|import)\s*\(?\s*['"](\.\.\/|@trebco)[^'"]*['"]/g;

let failed = false;

for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx|js)$/.test(entry.name)) { continue; }
  const file = join(entry.parentPath, entry.name);
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(pattern)) {
    console.error(`${file}: core may not import ${match[0]}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
