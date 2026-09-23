// Bundles src/ into a single classic script (game.js) so index.html can be
// opened directly from disk (file://) without a local server.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'game.js',
  minify,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await esbuild.build(options);
}
