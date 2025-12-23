import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', 
  build: {
    outDir: '../agent-debug/dist/ui', // Drop build directly into the npm package folder
    emptyOutDir: true,
  }
});