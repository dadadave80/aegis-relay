import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // The /map page imports committed fixtures from ../circuits at build time;
  // widen the Turbopack root to the repo so those imports resolve.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // The stateless server routes reuse the prover's crypto (Poseidon/EdDSA via
  // circomlibjs) and snarkjs for Groth16 proving. Both are heavy native/ESM
  // packages that must be required by Node at runtime, not bundled.
  serverExternalPackages: ["snarkjs", "circomlibjs"],
};

export default nextConfig;
