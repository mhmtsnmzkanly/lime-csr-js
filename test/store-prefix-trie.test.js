import assert from 'node:assert/strict';
import test from 'node:test';

import { createStore } from '../src/index.js';

test('prefix indexing correctly notifies nested descendants without false positives', () => {
  const store = createStore({
    user: {
      name: 'Alice',
      profile: {
        age: 30,
        city: 'Istanbul',
      },
    },
    user_profile: {
      other: 'value',
    },
    users: ['one', 'two'],
  });

  const calls = {
    userName: 0,
    userProfileAge: 0,
    userProfileCity: 0,
    user_profileOther: 0,
    users: 0,
  };

  const unsubName = store.subscribe('user.name', () => { calls.userName++; });
  const unsubAge = store.subscribe('user.profile.age', () => { calls.userProfileAge++; });
  const unsubCity = store.subscribe('user.profile.city', () => { calls.userProfileCity++; });
  const unsubOther = store.subscribe('user_profile.other', () => { calls.user_profileOther++; });
  const unsubUsers = store.subscribe('users', () => { calls.users++; });

  // Update root 'user'
  store.set('user', {
    name: 'Bob',
    profile: {
      age: 31,
      city: 'Ankara',
    },
  });

  // Descendants of 'user' must be notified
  assert.equal(calls.userName, 1);
  assert.equal(calls.userProfileAge, 1);
  assert.equal(calls.userProfileCity, 1);

  // Unrelated paths with prefix-like names MUST NOT be notified
  assert.equal(calls.user_profileOther, 0);
  assert.equal(calls.users, 0);

  // Update intermediate 'user.profile'
  store.set('user.profile', {
    age: 32,
    city: 'Izmir',
  });

  assert.equal(calls.userName, 1); // unchanged
  assert.equal(calls.userProfileAge, 2);
  assert.equal(calls.userProfileCity, 2);

  // Unsubscribe and verify no more notifications
  unsubAge();
  store.set('user.profile.age', 35);
  assert.equal(calls.userProfileAge, 2); // still 2

  unsubName();
  unsubCity();
  unsubOther();
  unsubUsers();
});

test('large number of subscribers are cleanly indexed and pruned', () => {
  const store = createStore({});
  const unsubs = [];
  let calls = 0;

  for (let i = 0; i < 500; i++) {
    unsubs.push(store.subscribe(`items.${i}.name`, () => { calls++; }));
  }

  // Set top-level items
  store.set('items', {});
  assert.equal(calls, 500);

  // Unsubscribe all
  for (const unsub of unsubs) unsub();

  // Set again, calls should not increase
  store.set('items', { test: true });
  assert.equal(calls, 500);
});
