// Vite configuration of the accessibility audit: the normal one, with "firebase/auth" replaced by tests/a11y/stubs/firebase-auth.js.
//   VITE_API_URL=http://127.0.0.1:8000 npx vite build --config tests/a11y/vite.config.mjs --outDir <dir> --emptyOutDir
import { defineConfig, mergeConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import base from '../../vite.config.js'

export default mergeConfig(base, defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: { alias: [{ find: 'firebase/auth', replacement: fileURLToPath(new URL('./stubs/firebase-auth.js', import.meta.url)) }] },
}))
