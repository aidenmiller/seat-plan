import path from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'server-only': path.resolve(import.meta.dirname, 'test/server-only-stub.ts'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: ['src/**/*.int.test.{ts,tsx}', 'node_modules/**'],
          setupFiles: ['test/setup-next.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.{ts,tsx}'],
          globalSetup: ['test/integration-setup.ts'],
          setupFiles: ['test/setup-next.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
})
