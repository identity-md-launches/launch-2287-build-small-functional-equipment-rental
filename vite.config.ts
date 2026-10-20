import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'happy-dom', include: ['tests/**/*.test.{ts,tsx}'], restoreMocks: true },
});
