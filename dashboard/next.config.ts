import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // The /map page imports committed fixtures from ../circuits at build time;
  // widen the Turbopack root to the repo so those imports resolve.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
