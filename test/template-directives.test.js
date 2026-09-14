import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  mount,
} from '../src/index.js';

test('template data-if renders correctly inside table without foster parenting', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-table-test">
          <table>
            <tbody id="tbody">
              <template data-if is-gt="count" than="0">
                <tr id="row-pos"><td>Positive: \${count}</td></tr>
                <template data-else>
                  <tr id="row-zero"><td>Zero or negative</td></tr>
                </template>
              </template>
            </tbody>
          </table>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');

  // Test true branch
  mount({ target: target, template: 'table-test', store: null, ...{
    context: { count: 5 },
  } });

  const rowPos = target.querySelector('#row-pos');
  const rowZero = target.querySelector('#row-zero');
  assert.ok(rowPos, 'row-pos should exist');
  assert.equal(rowZero, null, 'row-zero should not exist');
  assert.equal(rowPos.parentElement.id, 'tbody', 'row-pos must be inside tbody, not foster-parented outside table');
  assert.equal(rowPos.textContent.trim(), 'Positive: 5');

  // Test false branch
  mount({ target: target, template: 'table-test', store: null, ...{
    context: { count: 0 },
  } });

  const rowPos2 = target.querySelector('#row-pos');
  const rowZero2 = target.querySelector('#row-zero');
  assert.equal(rowPos2, null);
  assert.ok(rowZero2);
  assert.equal(rowZero2.parentElement.id, 'tbody');
});

test('template data-for renders correctly inside select elements', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-select-test">
          <select id="user-select">
            <template data-for each="users" as="u" index="i">
              <option value="\${u.id}">\${i}: \${u.name}</option>
            </template>
          </select>
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = document.getElementById('app');

  mount({ target: target, template: 'select-test', store: null, ...{
    context: {
      users: [
        { id: '1', name: 'Ada' },
        { id: '2', name: 'Alan' },
      ],
    },
  } });

  const select = target.querySelector('#user-select');
  const options = select.querySelectorAll('option');
  assert.equal(options.length, 2);
  assert.equal(options[0].value, '1');
  assert.equal(options[0].textContent, '0: Ada');
  assert.equal(options[1].value, '2');
  assert.equal(options[1].textContent, '1: Alan');
});
