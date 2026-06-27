#!/usr/bin/env node
/**
 * i18n-check.mjs
 *
 * Verifies that messages/en.json and messages/th.json have identical key sets
 * at every nesting level. Fails with exit code 1 if any keys are missing or
 * extra in either file — this keeps the CI build red until both files are in
 * sync.
 *
 * Usage: node scripts/i18n-check.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

function loadJSON(rel) {
  const abs = resolve(root, rel);
  try {
    return JSON.parse(readFileSync(abs, "utf-8"));
  } catch (e) {
    console.error(`Cannot read ${rel}: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Recursively collect all dotted key paths from a JSON object.
 * e.g. { a: { b: "x" } } → ["a.b"]
 */
function collectKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const en = loadJSON("messages/en.json");
const th = loadJSON("messages/th.json");

const enKeys = new Set(collectKeys(en));
const thKeys = new Set(collectKeys(th));

const missingInTH = [...enKeys].filter((k) => !thKeys.has(k));
const extraInTH = [...thKeys].filter((k) => !enKeys.has(k));

let failed = false;

if (missingInTH.length > 0) {
  failed = true;
  console.error(`\n❌  ${missingInTH.length} key(s) present in en.json but MISSING in th.json:\n`);
  missingInTH.forEach((k) => console.error(`   - ${k}`));
}

if (extraInTH.length > 0) {
  failed = true;
  console.error(`\n❌  ${extraInTH.length} key(s) present in th.json but MISSING in en.json:\n`);
  extraInTH.forEach((k) => console.error(`   - ${k}`));
}

if (failed) {
  console.error(
    "\nFix: add the missing keys to both files, then re-run npm run i18n-check.\n"
  );
  process.exit(1);
}

console.log(`✅  i18n parity OK — ${enKeys.size} keys in both en.json and th.json.`);
