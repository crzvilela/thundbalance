import { defineConfig, mergeConfig } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import base from '../../vite.config.js'
export default mergeConfig(base, defineConfig({ root: new URL('../../', import.meta.url).pathname.slice(1), plugins: [visualizer({ filename: process.env.STATS_FILE || 'stats.json', template: 'raw-data', gzipSize: true })] }))
