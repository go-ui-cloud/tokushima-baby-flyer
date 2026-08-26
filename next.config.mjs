/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / worker-heavy packages must stay outside Turbopack's server bundle.
  // This prevents @napi-rs/canvas/js-binding.js from being treated as an ESM asset.
  serverExternalPackages: [
    '@sparticuz/chromium',
    'puppeteer-core',
    'tesseract.js',
    '@napi-rs/canvas',
    'pdfjs-dist',
  ],
};

export default nextConfig;
