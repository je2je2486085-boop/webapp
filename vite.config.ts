import { defineConfig } from 'vite'
import cloudflarePages from '@hono/vite-cloudflare-pages'

export default defineConfig(() => {
  return {
    plugins: [cloudflarePages()],
    build: {
      lib: {
        entry: 'src/index.tsx',
        formats: ['es']
      },
      outDir: 'dist',
      emptyOutDir: true,
      minify: true
    },
    server: {
      port: 5173,
      strictPort: false
    }
  }
})
