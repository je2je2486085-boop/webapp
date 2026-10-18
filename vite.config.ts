import { defineConfig } from 'vite'
import { getEnv } from 'hono/adapter'
import cloudflarePages from '@hono/vite-cloudflare-pages'

export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [cloudflarePages()],
      server: {
        middlewareMode: true
      }
    }
  } else {
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
      }
    }
  }
})
