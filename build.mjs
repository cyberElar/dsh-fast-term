import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const client = await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
});

const flat = client.outputFiles[0].text;
const wrapped = 'window.__ModuleLoader__.load({ id: "dsh-fast-term", factory: (require) => {\n'
  + 'var module = { exports: {} };\nvar exports = module.exports;\n'
  + flat
  + '\nreturn module.exports;\n} });\n';
writeFileSync('lib/client.js', wrapped, 'utf8');
console.log('client.js bytes:', Buffer.byteLength(wrapped));

// The host bundles @xterm/headless so profile installs (file: dependencies)
// stay self-contained: profiles do not hoist that package on every platform.
const host = await build({
  entryPoints: ['src/host.js'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['ws'],
  legalComments: 'none',
  logLevel: 'info',
});

const hostText = host.outputFiles[0].text;
writeFileSync('lib/index.js', hostText, 'utf8');
console.log('index.js bytes:', Buffer.byteLength(hostText));
