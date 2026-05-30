import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — a stray package-lock.json in the home dir
  // otherwise makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50gb',
    },
  },
};

export default nextConfig;
