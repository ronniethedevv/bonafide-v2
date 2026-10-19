/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TS via their exports; Next must transpile them.
  transpilePackages: ["@mmr/read-model"],
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
