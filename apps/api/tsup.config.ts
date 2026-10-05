import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate-cli.ts', 'src/seed/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Bundle the workspace package; keep real npm dependencies external.
  noExternal: ['@cashads/shared'],
});
