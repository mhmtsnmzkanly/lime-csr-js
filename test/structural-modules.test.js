import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createEngine } from '../src/core/index.js';
import { partials, conditionals, loops } from '../src/modules/index.js';
import { createStore } from '../src/store.js';
import { setDevMode, subscribeDiagnostics } from '../src/errors.js';

function createDom(html = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  return dom;
}

function createStructuralEngine() {
  return createEngine({
    modules: [
      partials(),
      loops(),
      conditionals(),
    ],
  });
}

test.beforeEach(() => {
  setDevMode(false);
});

// ── 1. PARTIALS: BASIC & ISOLATED SCOPE & STORE SHARING ─────────────────────

test('partials: basic expansion with isolated scope and store sharing', () => {
  const dom = createDom(`
    <template id="tpl-user-badge">
      <span class="user">\${name} (\${role})</span>
      <span class="app">\${appTitle}</span>
    </template>
    <div id="root">
      <partial name="user-badge" data="currentUser" role="memberRole"></partial>
    </div>
  `);

  const store = createStore({ appTitle: 'Lime App' });
  const scope = {
    currentUser: { name: 'Alice' },
    memberRole: 'Admin',
    secretParentVar: 'shouldNotLeak',
  };

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ store, scope, document: dom.window.document } });

  assert.equal(root.querySelector('partial'), null);
  assert.equal(root.querySelector('.user').textContent, 'Alice (Admin)');
  // Fallback to shared store
  assert.equal(root.querySelector('.app').textContent, 'Lime App');
});

test('partials: missing name diagnostic and element removal', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom('<div id="root"><partial data="someData"></partial></div>');
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ document: dom.window.document } });

  assert.equal(root.querySelector('partial'), null);
  assert.ok(diagnostics.some((d) => d.code === 'PARTIAL_MISSING_NAME'));
  unsubscribe();
});

test('partials: missing template diagnostic', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom('<div id="root"><partial name="non-existent"></partial></div>');
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ document: dom.window.document } });

  assert.equal(root.querySelector('partial'), null);
  assert.ok(diagnostics.some((d) => d.code === 'PARTIAL_NOT_FOUND'));
  unsubscribe();
});

test('partials: nested partials with recursive scope isolation', () => {
  const dom = createDom(`
    <template id="tpl-outer">
      <div class="outer">
        <h3>\${title}</h3>
        <partial name="inner" data="child"></partial>
      </div>
    </template>
    <template id="tpl-inner">
      <span class="inner">\${childName}</span>
    </template>
    <div id="root">
      <partial name="outer" data="item"></partial>
    </div>
  `);

  const scope = {
    item: {
      title: 'Outer Card',
      child: { childName: 'Inner Badge' },
    },
  };

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  assert.equal(root.querySelector('.outer h3').textContent, 'Outer Card');
  assert.equal(root.querySelector('.inner').textContent, 'Inner Badge');
});

// ── 2. CONDITIONALS: OPERATORS & BRANCHING ──────────────────────────────────

test('conditionals: evaluates truthy/falsey branches with <else>', () => {
  const dom = createDom(`
    <div id="root">
      <div id="c1">
        <if is-truthy="isActive">
          <span class="yes">Active</span>
          <else><span class="no">Inactive</span></else>
        </if>
      </div>
      <div id="c2">
        <if is-truthy="isArchived">
          <span class="archived">Archived</span>
          <else><span class="current">Current</span></else>
        </if>
      </div>
    </div>
  `);

  const scope = { isActive: true, isArchived: false };
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  assert.equal(root.querySelector('#c1 .yes').textContent, 'Active');
  assert.equal(root.querySelector('#c1 .no'), null);
  assert.equal(root.querySelector('#c2 .current').textContent, 'Current');
  assert.equal(root.querySelector('#c2 .archived'), null);
});

test('conditionals: all comparison operators (is-gt, is-lt, is-gte, is-lte, is-eq, is-neq)', () => {
  const dom = createDom(`
    <div id="root">
      <p id="gt"><if is-gt="count" than="5"><span>GT</span><else><span>NOT GT</span></else></if></p>
      <p id="lt"><if is-lt="count" than="5"><span>LT</span><else><span>NOT LT</span></else></p>
      <p id="gte"><if is-gte="count" than="10"><span>GTE</span><else><span>NOT GTE</span></else></if></p>
      <p id="lte"><if is-lte="count" than="10"><span>LTE</span><else><span>NOT LTE</span></else></p>
      <p id="eq"><if is-eq="status" to="ready"><span>EQ</span><else><span>NOT EQ</span></else></if></p>
      <p id="neq"><if is-neq="status" to="ready"><span>NEQ</span><else><span>NOT NEQ</span></else></if></p>
    </div>
  `);

  const scope = { count: 10, status: 'ready' };
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  assert.equal(root.querySelector('#gt span').textContent, 'GT');
  assert.equal(root.querySelector('#lt span').textContent, 'NOT LT');
  assert.equal(root.querySelector('#gte span').textContent, 'GTE');
  assert.equal(root.querySelector('#lte span').textContent, 'LTE');
  assert.equal(root.querySelector('#eq span').textContent, 'EQ');
  assert.equal(root.querySelector('#neq span').textContent, 'NOT NEQ');
});

test('conditionals: template[data-if] and template[data-else] inside tables', () => {
  const dom = createDom(`
    <div id="root">
      <table>
        <tbody>
          <template data-if is-gt="score" than="50">
            <tr class="pass"><td>Pass</td></tr>
            <template data-else>
              <tr class="fail"><td>Fail</td></tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
  `);

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope: { score: 75 }, document: dom.window.document } });
  assert.ok(root.querySelector('tr.pass'));
  assert.equal(root.querySelector('tr.fail'), null);
});

test('conditionals: diagnostics for unknown and missing operators', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom(`
    <div id="root">
      <if is-something="x"><span>Test</span></if>
      <if><span>No Op</span></if>
    </div>
  `);

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ document: dom.window.document } });

  assert.ok(diagnostics.some((d) => d.code === 'UNKNOWN_OPERATOR'));
  assert.ok(diagnostics.some((d) => d.code === 'MISSING_OPERATOR'));
  unsubscribe();
});

test('conditionals: diagnostic for element after <else>', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom(`
    <div id="root">
      <if is-truthy="flag">
        <span>Then</span>
        <else><span>Else</span></else>
        <span>After Else Content</span>
      </if>
    </div>
  `);

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope: { flag: false }, document: dom.window.document } });

  assert.ok(diagnostics.some((d) => d.code === 'ELSE_AFTER_CONTENT'));
  unsubscribe();
});

// ── 3. LOOPS: ARRAY ITERATION & SCOPES ───────────────────────────────────────

test('loops: iterates array, creates lexical item scope and index', () => {
  const dom = createDom(`
    <div id="root">
      <for each="fruits" as="fruit" index="idx">
        <span class="item">\${idx}: \${fruit} (\${category})</span>
      </for>
    </div>
  `);

  const scope = {
    category: 'Fresh',
    fruits: ['Apple', 'Banana', 'Cherry'],
  };

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  const items = Array.from(root.querySelectorAll('.item')).map((el) => el.textContent.trim());
  assert.deepEqual(items, [
    '0: Apple (Fresh)',
    '1: Banana (Fresh)',
    '2: Cherry (Fresh)',
  ]);
});

test('loops: empty array removes <for> cleanly without errors', () => {
  const dom = createDom('<div id="root"><for each="emptyList" as="item"><p>${item}</p></for></div>');
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope: { emptyList: [] }, document: dom.window.document } });
  assert.equal(root.children.length, 0);
});

test('loops: non-array input emits FOR_NOT_ARRAY diagnostic', () => {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((d) => diagnostics.push(d));

  const dom = createDom('<div id="root"><for each="notAnArray" as="item"><p>${item}</p></for></div>');
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope: { notAnArray: 'invalid' }, document: dom.window.document } });

  assert.ok(diagnostics.some((d) => d.code === 'FOR_NOT_ARRAY'));
  assert.equal(root.querySelector('for'), null);
  unsubscribe();
});

test('loops: template[data-for] inside select element', () => {
  const dom = createDom(`
    <div id="root">
      <select id="sel">
        <template data-for each="options" as="opt">
          <option value="\${opt.val}">\${opt.label}</option>
        </template>
      </select>
    </div>
  `);

  const scope = {
    options: [
      { val: '1', label: 'One' },
      { val: '2', label: 'Two' },
    ],
  };

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  const opts = Array.from(root.querySelectorAll('option'));
  assert.equal(opts.length, 2);
  assert.equal(opts[0].value, '1');
  assert.equal(opts[0].textContent, 'One');
  assert.equal(opts[1].value, '2');
  assert.equal(opts[1].textContent, 'Two');
});

test('loops: nested loops with shadowing lexical scopes', () => {
  const dom = createDom(`
    <div id="root">
      <for each="matrix" as="row" index="r">
        <div class="row">
          <for each="row" as="cell" index="c">
            <span class="cell">\${r},\${c}:\${cell}</span>
          </for>
        </div>
      </for>
    </div>
  `);

  const scope = {
    matrix: [
      ['A', 'B'],
      ['C', 'D'],
    ],
  };

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ scope, document: dom.window.document } });

  const cells = Array.from(root.querySelectorAll('.cell')).map((el) => el.textContent.trim());
  assert.deepEqual(cells, [
    '0,0:A',
    '0,1:B',
    '1,0:C',
    '1,1:D',
  ]);
});

test('loops: large static expansion compiles nested structural work for every item', () => {
  const dom = createDom(`
    <div id="root">
      <for each="items" as="item">
        <if is-truthy="item.visible">
          <span class="item">\${item.id}</span>
          <else><em class="item">\${item.id}</em></else>
        </if>
      </for>
    </div>
  `);
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');
  const items = Array.from({ length: 1000 }, (_, id) => ({
    id,
    visible: id % 2 === 0,
  }));

  engine.mount({ target: root, scope: { items }, document: dom.window.document });

  const rendered = root.querySelectorAll('.item');
  assert.equal(rendered.length, items.length);
  assert.equal(rendered[0].textContent.trim(), '0');
  assert.equal(rendered[rendered.length - 1].textContent.trim(), '999');
  assert.equal(root.querySelector('for, if'), null);
});

// ── 4. INTEGRATION: FIXED-POINT COMPILATION OF NESTED STRUCTURAL MODULES ─────

test('integration: partial -> conditional -> loop -> nested partial compiles in fixed-point loop', () => {
  const dom = createDom(`
    <template id="tpl-user-card">
      <div class="card">
        <h2>\${user.name}</h2>
        <if is-truthy="user.showDetails">
          <div class="details">
            <for each="user.skills" as="skill">
              <partial name="skill-badge" skill-name="skill"></partial>
            </for>
          </div>
          <else><p>Details hidden</p></else>
        </if>
      </div>
    </template>
    <template id="tpl-skill-badge">
      <span class="badge">\${skill-name}</span>
    </template>

    <div id="app">
      <partial name="user-card" data="account"></partial>
    </div>
  `);

  const scope = {
    account: {
      user: {
        name: 'Grace Hopper',
        showDetails: true,
        skills: ['Compilers', 'COBOL', 'Architecture'],
      },
    },
  };

  const engine = createStructuralEngine();
  const app = dom.window.document.getElementById('app');

  engine.mount({ target: app, ...{ scope, document: dom.window.document } });

  assert.equal(app.querySelector('h2').textContent, 'Grace Hopper');
  const badges = Array.from(app.querySelectorAll('.badge')).map((el) => el.textContent.trim());
  assert.deepEqual(badges, ['Compilers', 'COBOL', 'Architecture']);
});

test('integration: deferred static loop snapshots retain scopes through partial and conditional nesting', () => {
  const dom = createDom(`
    <template id="tpl-row">
      <article class="row">
        <if is-truthy="visible">
          <for each="labels" as="label">
            <partial name="badge" label="label"></partial>
          </for>
          <else><span class="hidden">Hidden</span></else>
        </if>
      </article>
    </template>
    <template id="tpl-badge"><span class="badge">\${label}</span></template>
    <div id="root">
      <for each="records" as="record">
        <partial name="row" data="record"></partial>
      </for>
    </div>
  `);
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({
    target: root,
    scope: {
      records: [
        { visible: true, labels: ['One', 'Two'] },
        { visible: false, labels: ['Ignored'] },
      ],
    },
    document: dom.window.document,
  });

  assert.deepEqual(
    Array.from(root.querySelectorAll('.badge')).map((element) => element.textContent),
    ['One', 'Two'],
  );
  assert.equal(root.querySelectorAll('.row').length, 2);
  assert.equal(root.querySelectorAll('.hidden').length, 1);
  assert.equal(root.querySelector('partial, if, for'), null);
});

// ── 5. REACTIVE (DATA-LIVE) STRUCTURAL BEHAVIOR ─────────────────────────────

test('conditionals: reactive <if data-live> updates branch on store change', () => {
  const dom = createDom(`
    <div id="root">
      <if data-live is-truthy="showPanel">
        <section class="panel">Open</section>
        <else><div class="closed">Closed</div></else>
      </if>
    </div>
  `);

  const store = createStore({ showPanel: true });
  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  const unmount = engine.mount({ target: root, ...{ store, document: dom.window.document } });

  assert.ok(root.querySelector('.panel'));
  assert.equal(root.querySelector('.closed'), null);

  // Re-evaluate reactively
  store.set('showPanel', false);
  assert.equal(root.querySelector('.panel'), null);
  assert.ok(root.querySelector('.closed'));

  unmount();
});

test('loops: reactive <for data-live> performs keyed updates and preserves untouched DOM identity', () => {
  const dom = createDom(`
    <div id="root">
      <ul id="list">
        <template data-for each="items" as="item" key="id" data-live data-diff="lcs">
          <li data-key="\${item.id}">\${item.name}</li>
        </template>
      </ul>
    </div>
  `);

  const store = createStore({
    items: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ],
  });

  const engine = createStructuralEngine();
  const root = dom.window.document.getElementById('root');

  engine.mount({ target: root, ...{ store, document: dom.window.document } });

  const ul = root.querySelector('#list');
  const initialLi2 = ul.querySelector('li[data-key="2"]');
  assert.ok(initialLi2);

  // Reorder items: swap 1 and 3, keep 2 in place
  store.set('items', [
    { id: 3, name: 'Item 3' },
    { id: 2, name: 'Item 2' },
    { id: 1, name: 'Item 1' },
  ]);

  const afterLi2 = ul.querySelector('li[data-key="2"]');
  // LCS strategy preserves DOM node reference for stay-put items
  assert.equal(afterLi2, initialLi2);

  const texts = Array.from(ul.querySelectorAll('li')).map((li) => li.textContent.trim());
  assert.deepEqual(texts, ['Item 3', 'Item 2', 'Item 1']);
});

test('partials: mutating instantiated partial DOM does not mutate source <template> content', () => {
  const dom = createDom(`
    <template id="tpl-card">
      <div class="card original-class">
        <span class="title">Original Title</span>
      </div>
    </template>
    <div id="root1">
      <partial name="card"></partial>
    </div>
    <div id="root2">
      <partial name="card"></partial>
    </div>
  `);

  const tpl = dom.window.document.getElementById('tpl-card');
  const originalTplHtml = tpl.innerHTML;

  const engine = createStructuralEngine();
  const root1 = dom.window.document.getElementById('root1');
  engine.mount({ target: root1, ...{ document: dom.window.document } });

  const card1 = root1.querySelector('.card');
  assert.ok(card1);
  assert.equal(card1.querySelector('.title').textContent, 'Original Title');

  // Mutate the instantiated DOM node aggressively
  card1.className = 'card mutated-class';
  card1.querySelector('.title').textContent = 'Tainted Title';
  const extraNode = dom.window.document.createElement('div');
  extraNode.className = 'injected-node';
  card1.appendChild(extraNode);

  // Assert template content is completely untouched
  assert.equal(tpl.innerHTML, originalTplHtml, 'Template innerHTML must remain unmodified after instance mutation');
  assert.equal(tpl.content.querySelector('.mutated-class'), null);
  assert.equal(tpl.content.querySelector('.injected-node'), null);
  assert.equal(tpl.content.querySelector('.title').textContent, 'Original Title');

  // Mount root2 and verify it receives a clean, unmutated clone
  const root2 = dom.window.document.getElementById('root2');
  engine.mount({ target: root2, ...{ document: dom.window.document } });

  const card2 = root2.querySelector('.card');
  assert.ok(card2);
  assert.equal(card2.className, 'card original-class');
  assert.equal(card2.querySelector('.title').textContent, 'Original Title');
  assert.equal(card2.querySelector('.injected-node'), null);
});
