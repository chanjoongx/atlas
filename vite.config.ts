import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/types': path.resolve(__dirname, './src/types/index.ts'),
      '@/functions': path.resolve(__dirname, './functions'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

// Made with Bob
