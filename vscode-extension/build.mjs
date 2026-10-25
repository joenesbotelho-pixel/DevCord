import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const configs = [
  {
    entryPoints: ['src/extension.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/extension.js',
    external: ['vscode', 'bufferutil', 'utf-8-validate'],
    sourcemap: true,
  },
  {
    entryPoints: ['webview/main.jsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/webview.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
    minify: !watch,
  },
];

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('esbuild: observando alterações…');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log('esbuild: extensão compilada em dist/');
}
