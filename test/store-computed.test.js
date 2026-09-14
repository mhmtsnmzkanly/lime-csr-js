import assert from 'node:assert/strict';
import test from 'node:test';

import { createStore, getByPath } from '../src/store.js';

test('getByPath: missing child paths below primitive values return undefined', () => {
  const state = { user: { name: 'Ada' } };

  assert.equal(getByPath(state, 'user.name.first'), undefined);
  assert.equal(getByPath(state, 'user.name.missing'), undefined);
});

test('computed: passes dependency values to the calculation in declared order', () => {
  const store = createStore({
    price: 20,
    quantity: 3,
  });

  const dispose = store.computed('total', ['price', 'quantity'], (price, quantity) => price * quantity);

  assert.equal(store.get('total'), 60);

  store.set('quantity', 4);
  assert.equal(store.get('total'), 80);

  dispose();
  assert.equal(store.get('total'), undefined);
});

test('computed: replacing a computed path leaves the replacement active', () => {
  const store = createStore({ value: 2 });
  const firstDispose = store.computed('derived', ['value'], (value) => value * 2);
  const secondDispose = store.computed('derived', ['value'], (value) => value * 3);

  firstDispose();
  assert.equal(store.get('derived'), 6);

  store.set('value', 3);
  assert.equal(store.get('derived'), 9);

  secondDispose();
  assert.equal(store.get('derived'), undefined);
});

test('computed: rejects malformed paths, dependencies, and calculations before mutation', () => {
  const store = createStore({ value: 1 });

  assert.throws(
    () => store.computed('__proto__.derived', ['value'], () => 1),
    TypeError,
  );
  assert.throws(
    () => store.computed('derived', ['value', ''], () => 1),
    TypeError,
  );
  assert.throws(
    () => store.computed('derived', ['value'], null),
    TypeError,
  );
  assert.equal(store.get('derived'), undefined);
});
