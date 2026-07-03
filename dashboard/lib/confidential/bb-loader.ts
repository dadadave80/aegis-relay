/**
 * Browser bb.js loader (ported verbatim from the upstream ct-demo, which solved
 * every sub-problem here).
 *
 * bb.js's `dest/browser/` is copied into `public/vendor/bb/` by
 * scripts/vendor-bb.mjs (run via the app's predev/prebuild). We load it as a
 * NATIVE ES module from that stable path instead of letting the bundler bundle
 * it, because bb.js resolves its wasm Web Worker relative to `import.meta.url`
 * (`new Worker(new URL('./main.worker.js', import.meta.url))`, marked
 * `webpackIgnore`). Bundling moves `index.js` into a hashed chunk whose sibling
 * `main.worker.js` doesn't exist, so the worker never loads and proving hangs.
 * Served from `/vendor/bb/index.js`, `import.meta.url` points at a real
 * directory where the worker + wasm files are present.
 *
 * `nativeImport` is built with `new Function` so the bundler never sees an
 * `import()` to analyze/rewrite. It is constructed lazily inside the loader
 * callback (this module gets pulled into the SSR bundle even though proving is
 * browser-only). The function body is a fixed string literal and `url` is a
 * parameter — nothing is interpolated into it, so there is no injection surface
 * (BB_URL is a hard-coded same-origin path, not user input).
 */
import { setUltraHonkBackendLoader } from "@ctd/sdk";

let nativeImport: ((url: string) => Promise<Record<string, unknown>>) | undefined;

function getNativeImport(): (url: string) => Promise<Record<string, unknown>> {
  nativeImport ??= new Function("url", "return import(url)") as (
    url: string,
  ) => Promise<Record<string, unknown>>;
  return nativeImport;
}

const BB_URL = "/vendor/bb/index.js";

let registered = false;

/** Point the SDK prover at the native-ESM bb.js. Idempotent; browser-only. */
export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  setUltraHonkBackendLoader(async () => {
    const mod = await getNativeImport()(BB_URL);
    return mod.UltraHonkBackend as never;
  });
}
