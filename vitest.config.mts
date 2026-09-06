import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'tests/browser/**'] },
  resolve: { alias: { '@': path.resolve('.',) } },
});