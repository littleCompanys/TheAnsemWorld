import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Solana wallet libraries and @coral-xyz/anchor assume a Node.js
// environment — they reference `global`, `process`, `Buffer`, and
// Node's `crypto`. Vite's browser build doesn't include any of those.
// nodePolyfills() injects stub implementations so the bundle works in
// a browser without changing any application code.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Buffer is also patched manually in main.tsx; the polyfill
      // adds the global for libraries that import before main runs.
      include: ['buffer', 'process', 'crypto', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
})
