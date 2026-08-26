/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / worker-heavy packages are executed by Node.js at runtime rather
  // than being bundled into a server chunk.
  serverExternalPackages: [
    '@sparticuz/chromium',
    'puppeteer-core',
    'tesseract.js',
    '@napi-rs/canvas',
    'pdfjs-dist',
  ],

  // Next/Vercel file tracing does not always discover Sparticuz' compressed
  // Chromium assets because executablePath() resolves the bin directory at
  // runtime. Explicitly include them in the update Function.
  outputFileTracingIncludes: {
    '/api/update': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/@sparticuz/chromium/build/**',
    ],
    '/api/update/route': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/@sparticuz/chromium/build/**',
    ],
  },
};

export default nextConfig;
