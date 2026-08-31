import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/lib/score-bands': fileURLToPath(new URL('../../apps/outreach/lib/score-bands.ts', import.meta.url)),
      '@/products': fileURLToPath(new URL('../../products', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['components/genui/**/*.{ts,tsx}', 'hooks/use-capability-stream.ts'],
      exclude: ['components/genui/index.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 90,
        lines: 95,
      },
    },
  },
});
