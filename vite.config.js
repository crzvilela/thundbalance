/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// the release of the site (the first characters of the commit Vercel builds), sent with every error report
const release = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'

// The address of the API (the same value src/config.js reads): the page connects to it before the JavaScript asks for anything.
const env = loadEnv(process.env.NODE_ENV === 'production' ? 'production' : 'development', process.cwd(), 'VITE_')
const api = (process.env.VITE_API_URL || env.VITE_API_URL || 'https://thundbalance.onrender.com').replace(/\/+$/, '')

// Hints for the browser, written into index.html at build time:
//  - <meta name="tb-api"> (read by public/early.js, which starts the content and prices requests at once),
//  - preconnect to the API (the free host wakes up and the TLS handshake is done while the page loads),
//  - preload of the two font files the first screen uses (Bebas Neue titles, Inter text): the browser would only find them after the CSS.
function earlyHints() {
  return {
    name: 'early-hints',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const tags = [
          { tag: 'meta', attrs: { name: 'tb-api', content: api }, injectTo: 'head-prepend' },
          { tag: 'link', attrs: { rel: 'preconnect', href: api, crossorigin: '' }, injectTo: 'head-prepend' },
        ]
        const files = Object.keys(context.bundle || {}).filter(name => /(bebas-neue-latin-400-normal|inter-latin-wght-normal|roboto-latin-400-normal)[^/]*\.woff2$/.test(name))
        for (const file of files) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' }, injectTo: 'head-prepend' })
        return tags
      },
    },
  }
}

export default defineConfig({
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(release) },
  plugins: [
    react(),
    tailwindcss(),
    earlyHints(),
  ],
  build: {
    rolldownOptions: {
      output: {
        // The libraries that change rarely get files of their own, so they stay in the visitor's cache between deploys of the site's
        // code, and a page downloads only the ones it uses (the calendar and the phone-number library are not part of the landing page).
        advancedChunks: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom)[\/]/, priority: 10 },
            { name: 'firebase', test: /node_modules[\/](@firebase|firebase|idb)[\/]/ },
            { name: 'fullcalendar', test: /node_modules[\/](@fullcalendar|preact)[\/]/ },
            { name: 'phone-numbers', test: /node_modules[\/]libphonenumber-js[\/]/ },
          ],
        },
      },
    },
  },
})