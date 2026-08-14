import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:8001'

  return {
    plugins: [react()],
    define: { global: 'globalThis' },
    build: { target: 'es2016' },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
        }
      }
    }
  }
})
