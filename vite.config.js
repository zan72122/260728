import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// AQUA VELOCITY — build config
//
// - `base: './'` so the production build can be served from any static path
//   (no absolute root assumptions).
// - `resolve.alias` maps the documented `three/addons/...` import spec used
//   throughout SPEC.md to the actual `three/examples/jsm/...` package path.
//   (three@0.180.0 also exposes this via its own package "exports" map, but
//   the alias is kept explicit per project contract so the mapping is never
//   ambiguous regardless of resolution order.)
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      {
        find: 'three/addons/',
        replacement: fileURLToPath(new URL('./node_modules/three/examples/jsm/', import.meta.url)),
      },
    ],
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
