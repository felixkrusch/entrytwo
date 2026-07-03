import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  // Make pdf-parse + pdfjs-dist external on the server.
  // This prevents Next/Turbopack from bundling the pdf.js worker code,
  // which was causing: "Setting up fake worker failed: Cannot find module 'pdf.worker.mjs'"
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
}

export default withNextIntl(nextConfig)
