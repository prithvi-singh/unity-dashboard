/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained build with only the files needed to run the app.
  // Reduces Docker image size by ~60% and improves cold-start time on Vercel/containers.
  output: 'standalone',
};

module.exports = nextConfig;
