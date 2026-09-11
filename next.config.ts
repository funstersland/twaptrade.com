import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  webpack(config, { webpack }) {
    // In /app containers, resolve /app/app/page.tsx directly instead of
    // prepending the project root and loading /app/app/app/page.tsx.
    config.resolve.preferAbsolute = true;
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, path.resolve("lib/server/node-env.ts")));
    return config;
  },
};

export default nextConfig;
