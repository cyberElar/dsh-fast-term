import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
});

const flat = result.outputFiles[0].text;
const wrapped = 'window.__ModuleLoader__.load({ id: "dsh-fast-term", factory: (require) => {\n'
  + 'var module = { exports: {} };\nvar exports = module.exports;\n'
  + flat
  + '\nreturn module.exports;\n} });\n';
writeFileSync('lib/client.js', wrapped, 'utf8');
console.log('client.js bytes:', Buffer.byteLength(wrapped));
