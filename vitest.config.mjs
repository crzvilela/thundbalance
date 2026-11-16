import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Accessibility tests (npm run test:a11y): React components in jsdom + axe-core. The Node tests (node --test) are separate.
// jsdom has no layout engine, so colour contrast is NOT checked here: see docs/ACCESSIBILITY.md for the audit in a real browser.
export default defineConfig({
  plugins: [react()],
  oxc: { jsx: { runtime: 'automatic' } },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', include: ['src/**/*.spec.jsx'], globals: false, css: false },
})
