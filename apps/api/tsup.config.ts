import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed-cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // The workspace package ships TypeScript source — bundle it in.
  noExternal: ['@cashads/shared'],
});
