import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temp = mkdtempSync(path.join(tmpdir(), 'lime-csr-consumer-'));
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
  const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tarContents = run('tar', ['-tzf', tarball]).split('\n').filter(Boolean);

  for (const required of ['package.json', 'src/index.js', 'src/core/index.js', 'src/modules/index.js',
    'dist/index.min.js', 'dist/core.min.js', 'dist/store.min.js', 'dist/modules/text.min.js']) {
    assert.ok(tarContents.includes(`package/${required}`), `packed package is missing ${required}`);
  }
  for (const forbidden of ['package/examples/', 'package/test/', 'package/scripts/', 'package/node_modules/']) {
    assert.equal(tarContents.some((entry) => entry.startsWith(forbidden)), false,
      `packed package unexpectedly contains ${forbidden}`);
  }
  const allowedRoots = new Set(packageManifest.files.map((entry) => `package/${entry.replace(/\/$/, '')}`));
  for (const entry of tarContents) {
    if (entry === 'package/' || entry === 'package/package.json' || entry === 'package/README.md'
      || entry === 'package/LICENSE' || entry === 'package/LICENCE.md') continue;
    assert.ok([...allowedRoots].some((allowed) => entry === allowed || entry.startsWith(`${allowed}/`)),
      `packed file is outside package.files: ${entry}`);
  }

  writeFileSync(path.join(temp, 'package.json'), JSON.stringify({
    name: 'lime-csr-external-consumer',
    private: true,
    type: 'module',
    dependencies: { 'lime-csr-js': `file:${tarball}` },
  }, null, 2));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temp, stdio: 'inherit' });

  writeFileSync(path.join(temp, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import { mount, createStore, createEngine, defineModule } from 'lime-csr-js';
    import * as core from 'lime-csr-js/core';
    import * as modules from 'lime-csr-js/modules';
    import text from 'lime-csr-js/modules/text';
    import events from 'lime-csr-js/modules/events';
    await import('lime-csr-js/dist/index.min.js');
    assert.equal(typeof mount, 'function');
    assert.equal(typeof createStore, 'function');
    assert.equal(typeof createEngine, 'function');
    assert.equal(typeof defineModule, 'function');
    assert.equal(typeof core.createEngine, 'function');
    assert.equal(typeof core.defineModule, 'function');
    assert.equal(typeof core.attr, 'function');
    assert.equal(typeof modules.text, 'function');
    assert.equal(typeof modules.events, 'function');
    assert.equal(typeof modules.loops, 'function');
    assert.equal(typeof text, 'function');
    assert.equal(typeof events, 'function');
    console.log('packed consumer imports passed');
  `);
  run(process.execPath, ['consumer.mjs'], { cwd: temp, stdio: 'inherit' });
  console.log(`Packed consumer validation passed: ${path.basename(tarball)}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
