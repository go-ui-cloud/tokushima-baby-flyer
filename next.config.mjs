/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@sparticuz/chromium',
    'puppeteer-core',
    'tesseract.js',
    'tesseract.js-core',
    '@napi-rs/canvas',
    'pdfjs-dist',
  ],

  // Runtime-resolved native/WASM assets are not always discovered by Next's
  // file tracer. Include them explicitly in the Vercel update Function.
  outputFileTracingIncludes: {
    '/api/update': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/@sparticuz/chromium/build/**',
      './node_modules/tesseract.js/**',
      './node_modules/tesseract.js-core/**',
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
    '/api/update/route': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/@sparticuz/chromium/build/**',
      './node_modules/tesseract.js/**',
      './node_modules/tesseract.js-core/**',
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
  },
};

export default nextConfig;
