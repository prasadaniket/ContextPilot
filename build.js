const esbuild = require('esbuild')
const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['chrome120'],
  format: 'iife',
  logLevel: 'info',
}

const builds = [
  {
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    ...shared,
  },
  {
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content_script.js',
    globalName: '__CP_ENTRY__',
    ...shared,
  },
  {
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
    ...shared,
  },
]

if (watch) {
  Promise.all(builds.map(b => esbuild.context(b).then(ctx => ctx.watch())))
    .then(() => console.log('[ContextPilot build] watching…'))
    .catch(err => { console.error(err); process.exit(1) })
} else {
  Promise.all(builds.map(b => esbuild.build(b)))
    .then(() => console.log('[ContextPilot build] done'))
    .catch(err => { console.error(err); process.exit(1) })
}
