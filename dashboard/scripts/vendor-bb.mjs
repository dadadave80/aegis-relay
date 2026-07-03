/**
 * Vendor @aztec/bb.js's browser build into the dashboard's public/ directory.
 *
 * Why (verbatim rationale from the upstream ct-demo, which solved this): bb.js
 * spawns its wasm Web Worker with
 *   new Worker(new URL(/* webpackIgnore *​/ './main.worker.js', import.meta.url), { type: 'module' })
 * A bundler neither rewrites that URL nor emits the worker file, so once bb.js is
 * bundled into a hashed chunk the worker resolves to a non-existent
 * `/_next/static/chunks/main.worker.js` and proving hangs forever. Serving the
 * intact `dest/browser/` directory at a stable public path lets
 * `import.meta.url`-relative resolution find the sibling worker + wasm files. The
 * app loads it as native ESM (see lib/confidential/bb-loader.ts), bypassing the
 * bundler entirely.
 *
 * Adapted for bun's hoisted node_modules (bb.js is a transitive dep of @ctd/sdk):
 * prefer the hoisted top-level copy, then fall back to a nested install.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, ".."); // dashboard/

function findBrowserDir() {
  const candidates = [
    join(appRoot, "node_modules", "@aztec", "bb.js", "dest", "browser"),
    join(appRoot, "node_modules", "@ctd", "sdk", "node_modules", "@aztec", "bb.js", "dest", "browser"),
  ];
  return candidates.find((d) => existsSync(join(d, "index.js")));
}

const srcDir = findBrowserDir();
if (!srcDir) {
  throw new Error("could not locate @aztec/bb.js dest/browser under node_modules (run `bun install` first)");
}

const destDir = join(appRoot, "public", "vendor", "bb");
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

const files = await readdir(destDir);
console.log(`vendored @aztec/bb.js browser build`);
console.log(`  from ${srcDir}`);
console.log(`  to   ${destDir}`);
console.log(`  files: ${files.join(", ")}`);
