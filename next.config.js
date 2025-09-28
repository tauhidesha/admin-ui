/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Ensure the `@/` alias works in all environments, including Vercel's build servers
    config.resolve.alias['@'] = __dirname;
    return config;
  },
};

module.exports = nextConfig;
