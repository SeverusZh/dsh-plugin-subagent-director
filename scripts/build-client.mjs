// scripts/build-client.mjs
// Bundle src/client/index.ts into lib/client/index.js as a DSH client bundle:
//   window.__ModuleLoader__.load({ id, factory: (require) => { ...cjs body..., return module.exports } })
// External modules (react, @deepseek-ai/*) stay as require() calls resolved by the
// browser-side client module system (dsh-client-modules). tsc owns the .d.ts for the
// client entry; this script owns the runtime bundle.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const { rolldown } = await require('rolldown');

/** Identifiers to externalize: runtime + framework + react family stays out of the bundle. */
const external = [
  /^@deepseek-ai\//,
  /^react($|\/)/,
  /^react-dom($|\/)/
];

const bundle = await rolldown({
  input: join(root, 'src/client/index.ts'),
  external
});

const { output } = await bundle.generate({
  format: 'cjs',
  entryFileNames: 'index.js',
  sourcemap: false
});

const chunk = output.find((o) => o.type === 'chunk');
if (!chunk) throw new Error('build-client: no chunk produced');

// The CJS body uses free `exports`/`require`; the DSH loader calls factory(require)
// and reads the returned module.exports. Wrap exactly like the reference bundles.
const body = chunk.code.replace(/^\uFEFF/, '');
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(pkg.name) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body.replace(/^/gm, '\t\t'),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  ''
].join('\n');

mkdirSync(join(root, 'lib/client'), { recursive: true });
writeFileSync(join(root, 'lib/client/index.js'), wrapped);
console.log('build-client: wrote lib/client/index.js (' + wrapped.split('\n').length + ' lines, ' + wrapped.length + ' bytes)');