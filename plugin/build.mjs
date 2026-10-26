import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// The bundle id must equal the package name: the shell's module loader keys
// the registered factory by that id, and the bundle row in the profile patch
// resolves the package by the same name.
const PACKAGE_ID = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name;

/**
 * The browser module loader expects a classic script that registers a factory
 * under the package id, so the bundle is wrapped in the loader envelope.
 */
const wrap = {
  banner: {
    js: `window.__ModuleLoader__.load({
	id: "${PACKAGE_ID}",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;`,
  },
  footer: {
    js: `		return module.exports;
	}
});`,
  },
};

await build({
  entryPoints: ['src/client-entry.js'],
  outfile: 'client.js',
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  logLevel: 'info',
  // React comes from the shell's module table; a second copy would break hooks.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  ...wrap,
});
