import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temp = mkdtempSync(path.join(tmpdir(), 'lime-csr-types-'));
let tarball = null;

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    ...options,
  });
  return typeof output === 'string' ? output.trim() : '';
}

try {
  const packJson = JSON.parse(run(npm, ['pack', '--json', '--silent', '--ignore-scripts']));
  const packRecord = Array.isArray(packJson) ? packJson[0] : Object.values(packJson)[0];
  tarball = path.resolve(root, packRecord.filename);
  writeFileSync(path.join(temp, 'package.json'), JSON.stringify({
    name: 'lime-csr-types-consumer',
    private: true,
    type: 'module',
    dependencies: { 'lime-csr-js': `file:${tarball}` },
  }, null, 2));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp, stdio: 'inherit' });

  writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      strict: false,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
    },
    include: ['consumer.ts'],
  }, null, 2));
  writeFileSync(path.join(temp, 'consumer.ts'), `
    import { createStore, mount, createEngine, defineModule, attr } from 'lime-csr-js';
    import { createEngine as createCoreEngine } from 'lime-csr-js/core';
    import { text, events } from 'lime-csr-js/modules';

    const store = createStore({ count: 0, item: { status: 'open' } });
    store.set('count', 1);
    store.update('count', (value) => value + 1);
    const stop = store.subscribe('count', (next, previous, changedPath) => {
      console.log(next, previous, changedPath);
    });
    const instance = mount({ target: '#app', template: 'demo', store });
    instance.cleanup();
    instance.unmount();
    const module = defineModule({
      name: 'status-watch',
      triggers: [attr('data-status', (element, value, ctx) => {
        ctx.watch('item.status', (next, previous, changedPath) => {
          element.setAttribute('data-current', String(next));
          console.log(previous, changedPath);
        });
        ctx.onCleanup(() => element.removeAttribute('data-current'));
        ctx.emit('status-ready', { value });
      })],
    });
    const engine = createEngine({ modules: [module, text(), events()] });
    const coreEngine = createCoreEngine({ modules: [module] });
    void stop;
    void engine;
    void coreEngine;
  `);
  const tsc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  run(tsc, ['--project', path.join(temp, 'tsconfig.json')], { cwd: temp, stdio: 'inherit' });
  assert.ok(true);
  console.log('External TypeScript consumer passed with current JSDoc surface (strict=false, allowJs=true).');
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
