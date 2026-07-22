import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // Skip type-checking during build — run `pnpm typecheck` separately
  dts: false,
  noExternal: [],
});
