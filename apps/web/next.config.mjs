import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TS via their exports; Next must transpile them.
  transpilePackages: ["@mmr/read-model", "@mmr/engagement-file"],
  // The Compact runtime loads WebAssembly from its own package; run it from node_modules
  // instead of bundling it (the live engagement pages decode contract state with it).
  serverExternalPackages: ["@midnight-ntwrk/compact-runtime", "@midnightntwrk/onchain-runtime-v4"],
  // pnpm hoists deps to the workspace-root node_modules/.pnpm store, so file
  // tracing must be rooted at the monorepo root or standalone/prebuilt output
  // (e.g. `vercel build`) can't find traced server files.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  experimental: {},
  // The shared packages use NodeNext ".js" import specifiers that resolve to ".ts"
  // sources; teach webpack to follow them.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
