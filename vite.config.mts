import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'globalThis',
    '__VUE_OPTIONS_API__': 'true',
    '__VUE_PROD_DEVTOOLS__': 'false',
    '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false'
  },
  build: {
    lib: {
      entry: './src/main.ts',
      formats: ['es'],
      fileName: 'promptpalette-vue'
    },
    rollupOptions: {
      external: [
        /^\/scripts\/.*/,
        '../../../scripts/app.js',
        '../../../scripts/api.js',
        '../../../scripts/domWidget.js',
        '../../../scripts/utils.js',
      ],
      output: {
        dir: 'web',
        assetFileNames: 'vue-assets/[name].[ext]',
        entryFileNames: 'promptpalette-vue.js'
      }
    },
    outDir: 'web',
    sourcemap: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    emptyOutDir: false  // Don't delete existing files in web/
  }
})
