import type { NextConfig } from "next";
import path from "path";

/**
 * The confidential wallet generates UltraHonk proofs in the BROWSER via bb.js,
 * which needs multithreading → SharedArrayBuffer → cross-origin isolation.
 * COOP=same-origin + COEP=credentialless isolates the page while still letting
 * `fetch()` reach the Soroban RPC without that endpoint sending CORP headers.
 * (Ported from the upstream ct-demo, which proved this stack in browser.)
 */
const crossOriginIsolation = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
  // We build with `next build --webpack` (see package.json). Turbopack was tried
  // first (Phase A′ spike) but it cannot follow bun's `file:` symlink layout for
  // @ctd/sdk: it rejects symlinks whose realpath escapes the root, and even with
  // a widened root it refuses to parse the symlinked package.json ("a redirect
  // can't be parsed as json"). The upstream ct-demo ships a proven webpack config
  // for the identical @ctd/sdk + bb.js stack, so we mirror it. `turbopack.root`
  // is kept for any non-SDK Turbopack use (e.g. the /map circuits import).
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // /map imports fixtures from ../circuits and @ctd/sdk is a `file:` link into
  // ../vendor/ctd-sdk — both outside dashboard/. webpack needs externalDir to
  // follow imports outside the project root.
  experimental: { externalDir: true },
  // @ctd/sdk ships untranspiled TS/ESM; Next must transpile it in the app graph.
  transpilePackages: ["@ctd/sdk"],
  // The stateless server routes reuse the prover's crypto (Poseidon/EdDSA via
  // circomlibjs) and snarkjs for Groth16 proving. Both are heavy native/ESM
  // packages that must be required by Node at runtime, not bundled. @aztec/bb.js
  // is here too: the server-side audit decrypt imports @ctd/sdk (whose proving
  // module has a dynamic `import("@aztec/bb.js")`), but audit only DECRYPTS —
  // it never proves — so bb.js must never be bundled into the server route.
  serverExternalPackages: ["snarkjs", "circomlibjs", "@aztec/bb.js"],
  async headers() {
    return [{ source: "/(.*)", headers: crossOriginIsolation }];
  },
  // bb.js UltraHonk backend: loaded as native ESM from /vendor/bb at runtime (see
  // lib/confidential/bb-loader.ts), NEVER bundled. Its browser build declares a
  // top-level export that collides with webpack's module runtime and spawns a
  // wasm Web Worker whose sibling files can't live in a hashed chunk. So on the
  // client we alias the bare specifier to false — the SDK's Node-only default
  // loader is the only static reference, and bb-loader overrides it before
  // proving. (Ported verbatim from ct-demo/packages/app/next.config.mjs.)
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    // @ctd/sdk is a vendored `file:` package symlinked into node_modules. Resolve
    // it through the symlink (not its realpath under vendor/ctd-sdk, which has no
    // adjacent node_modules) so its runtime deps — the package manager nested them
    // under node_modules/@ctd/sdk — are found. Without this, webpack resolves from
    // the realpath and can't find @stellar/stellar-sdk, @noble/*, etc.
    config.resolve.symlinks = false;
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, "@aztec/bb.js": false };
    }
    return config;
  },
};

export default nextConfig;
