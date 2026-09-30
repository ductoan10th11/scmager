import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const apiTarget = process.env.API_TARGET || 'http://sc-api:8004'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8005,
    allowedHosts: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 8005,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
})
