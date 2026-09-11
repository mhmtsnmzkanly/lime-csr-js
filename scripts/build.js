import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const distModulesDir = path.resolve(distDir, 'modules');

// Ensure output directories exist
fs.mkdirSync(distModulesDir, { recursive: true });

const commonOptions = {
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
};

const externalErrors = [
  './errors-messages.js',
  '../errors-messages.js',
  '*/errors-messages.js',
];

async function runBuild() {
  console.log('Building Lime-CSR distribution files...');

  const targets = [
    // 1. Full bundle (default engine + all modules + store + router)
    {
      entry: 'src/index.js',
      outfile: 'dist/index.min.js',
      external: externalErrors,
    },
    // 2. Micro-Kernel bundle (createEngine, defineModule, triggers, scope, createStore)
    {
      entry: 'src/core/index.js',
      outfile: 'dist/core.min.js',
      external: externalErrors,
    },
    // 3. Standalone Store bundle (createStore, getByPath, setByPath)
    {
      entry: 'src/store.js',
      outfile: 'dist/store.min.js',
      external: externalErrors,
    },
    // 4. Standalone Router bundle (createRouter)
    {
      entry: 'src/core/router.js',
      outfile: 'dist/router.min.js',
      external: externalErrors,
    },
    // 5. All Standard Modules bundle
    {
      entry: 'src/modules/index.js',
      outfile: 'dist/modules/index.min.js',
      external: externalErrors,
    },
    // 6. Discrete Standard Modules (one per module)
    {
      entry: 'src/modules/partials.js',
      outfile: 'dist/modules/partials.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/conditionals.js',
      outfile: 'dist/modules/conditionals.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/loops.js',
      outfile: 'dist/modules/loops.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/text.js',
      outfile: 'dist/modules/text.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/show.js',
      outfile: 'dist/modules/show.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/model.js',
      outfile: 'dist/modules/model.min.js',
      external: externalErrors,
    },
    {
      entry: 'src/modules/events.js',
      outfile: 'dist/modules/events.min.js',
      external: externalErrors,
    },
    // 7. On-demand dev error explanations
    {
      entry: 'src/errors-messages.js',
      outfile: 'dist/errors-messages.js',
      external: [],
    },
  ];

  for (const t of targets) {
    await esbuild.build({
      ...commonOptions,
      entryPoints: [path.resolve(rootDir, t.entry)],
      outfile: path.resolve(rootDir, t.outfile),
      external: t.external,
    });
  }

  // 8. Add re-export shim for modules/errors-messages.js so dynamic imports resolve in nested subfolder
  fs.writeFileSync(
    path.resolve(distModulesDir, 'errors-messages.js'),
    "export * from '../errors-messages.js';\nexport { default } from '../errors-messages.js';\n",
  );

  console.log('Build completed successfully.');
}

runBuild().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
