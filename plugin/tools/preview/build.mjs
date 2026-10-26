import { build } from 'esbuild';

await build({
  entryPoints: ['tools/preview/preview.js'],
  outfile: 'tools/preview/preview.bundle.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: false,
  logLevel: 'info',
});
