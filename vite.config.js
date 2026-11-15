/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// the release of the site (the first characters of the commit Vercel builds), sent with every error report
const release = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'

export default defineConfig({
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(release) },
  plugins: [
    react(),
    tailwindcss(),
  ],
})