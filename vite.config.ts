import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: ['es2020', 'chrome87', 'safari14'],
    cssTarget: ['chrome87', 'safari14'],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4174',
      '/SavanoCine.apk': 'http://127.0.0.1:4174',
    },
  },
})
