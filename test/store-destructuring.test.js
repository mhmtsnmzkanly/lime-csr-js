import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/index.js';

test('Finding O: all public Store methods are safe when destructured individually', () => {
  const store = createStore({ count: 10, a: 1, b: 2 });

  // Destructure each method individually
  const { get, set, update, subscribe, batch, computed } = store;

  // 1. get
  assert.equal(get('count'), 10);
  assert.equal(get().count, 10);

  // 2. subscribe
  const seen = [];
  const unsub = subscribe('count', (val) => seen.push(val));

  // 3. set
  set('count', 11);
  assert.equal(get('count'), 11);
  assert.deepEqual(seen, [11]);

  // 4. update
  update('count', (c) => c + 1);
  assert.equal(get('count'), 12);
  assert.deepEqual(seen, [11, 12]);

  // 5. batch
  batch(() => {
    set('count', 20);
    set('count', 30);
  });
  assert.equal(get('count'), 30);

  // 6. computed
  const disposeComputed = computed('sum', ['a', 'b'], (a, b) => a + b);
  assert.equal(get('sum'), 3);
  set('a', 5);
  assert.equal(get('sum'), 7);

  disposeComputed();
  assert.equal(get('sum'), undefined);

  unsub();
});
