import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import * as RootAPI from '../src/index.js';
import * as CoreAPI from '../src/core/index.js';
import * as ModulesAPI from '../src/modules/index.js';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function readDoc(filename) {
  return fs.readFileSync(path.join(ROOT_DIR, filename), 'utf8');
}

test('documentation: version consistency across all documentation files', () => {
  const pkg = JSON.parse(readDoc('package.json'));
  assert.equal(pkg.version, '0.3.1');

  const files = ['README.md', 'DOCS.md', 'llms.txt', 'llms-full.txt', 'CHANGELOG.md'];
  for (const file of files) {
    const content = readDoc(file);
    assert.match(
      content,
      /0\.3\.1/,
      `File ${file} must reference version 0.3.1`,
    );
    // In CHANGELOG.md, 0.2.10 can be mentioned in history; in others it should not appear as current version
    if (file !== 'CHANGELOG.md') {
      assert.doesNotMatch(
        content,
        /lime-csr-js@0\.2\./,
        `File ${file} should not reference obsolete 0.2.x install tags`,
      );
    }
  }
});

test('documentation: removed legacy APIs do not appear as current APIs', () => {
  const removedSymbols = [
    'definePlugin',
    'PLUGIN_API_VERSION',
    'createPluginRuntime',
    'adaptPluginToModule',
    'setupBindings',
    'setupModelBindings',
    'setupShowBindings',
    'setupEventBindings',
    'setupLiveIfs',
    'setupLiveFors',
    'expandLoops',
    'expandPartials',
    'evalCondition',
    'processAllIfs',
    'engine.use(',
  ];

  // Check llms.txt and llms-full.txt: these must NEVER mention removed symbols as active APIs
  const llms = readDoc('llms.txt');
  const llmsFull = readDoc('llms-full.txt');

  for (const symbol of removedSymbols) {
    // In llms.txt, removed symbols are strictly absent except in "What NOT to do" notes if any
    assert.ok(
      !llms.includes(`export { ${symbol}`) && !llms.includes(`import { ${symbol}`),
      `llms.txt must not import or export removed symbol ${symbol}`,
    );
    assert.ok(
      !llmsFull.includes(`export { ${symbol}`) && !llmsFull.includes(`import { ${symbol}`),
      `llms-full.txt must not import or export removed symbol ${symbol}`,
    );
  }
});

test('documentation: all documented public root exports exist on RootAPI', () => {
  const documentedRootExports = [
    'mount',
    'unmount',
    'render',
    'createStore',
    'getByPath',
    'setByPath',
    'getTemplate',
    'resolveStatic',
    'renderTemplate',
    'escapeHtml',
    'safeAttr',
    'safeUrl',
    'safeStyleUrl',
    'setDevMode',
    'isDevMode',
    'subscribeDiagnostics',
    'warn',
    'reportError',
    'error',
    'loadDevMessages',
    'createEngine',
    'defineModule',
    'attr',
    'attrs',
    'tag',
    'pattern',
    'createScope',
    'partials',
    'conditionals',
    'loops',
    'text',
    'show',
    'model',
    'events',
  ];

  assert.equal(documentedRootExports.length, 34);
  for (const name of documentedRootExports) {
    assert.ok(
      name in RootAPI,
      `Documented export "${name}" must exist on root package index.js`,
    );
  }
  assert.equal(Object.keys(RootAPI).length, 34);
});

test('documentation: core and modules subpath exports exist as documented', () => {
  const coreExports = ['createEngine', 'defineModule', 'attr', 'attrs', 'tag', 'pattern', 'createScope'];
  for (const name of coreExports) {
    assert.ok(name in CoreAPI, `Core export "${name}" must exist in lime-csr-js/core`);
  }

  const moduleExports = ['partials', 'conditionals', 'loops', 'text', 'show', 'model', 'events'];
  for (const name of moduleExports) {
    assert.ok(name in ModulesAPI, `Module export "${name}" must exist in lime-csr-js/modules`);
  }
});

test('documentation: markdown relative file links resolve to real files', () => {
  const filesToCheck = ['README.md', 'DOCS.md', 'CHANGELOG.md'];

  for (const file of filesToCheck) {
    const content = readDoc(file);
    // Find all markdown links: [text](path)
    const linkRegex = /\[([^\]]+)\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const linkTarget = match[2];
      // Ignore web URLs
      if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://') || linkTarget.startsWith('file://')) {
        continue;
      }
      const resolvedPath = path.resolve(ROOT_DIR, linkTarget);
      assert.ok(
        fs.existsSync(resolvedPath),
        `Link in ${file} pointing to "${linkTarget}" must exist on disk (resolved: ${resolvedPath})`,
      );
    }
  }
});

test('documentation: code examples in README.md and llms.txt parse as valid JavaScript', () => {
  const files = ['README.md', 'llms.txt'];

  for (const docFile of files) {
    const content = readDoc(docFile);
    const jsBlockRegex = /```js\n([\s\S]*?)```/g;
    let match;
    let index = 0;
    while ((match = jsBlockRegex.exec(content)) !== null) {
      index++;
      const code = match[1];
      const tmpPath = path.join(os.tmpdir(), `lime-doc-test-${path.basename(docFile)}-${index}.mjs`);
      try {
        fs.writeFileSync(tmpPath, code, 'utf8');
        execSync(`node --check ${tmpPath}`, { stdio: 'pipe' });
      } catch (err) {
        assert.fail(`JS code block #${index} in ${docFile} failed syntax check:\n${code}\n${err.message}`);
      } finally {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      }
    }
    assert.ok(index > 0, `${docFile} should contain verified JS code blocks`);
  }
});
