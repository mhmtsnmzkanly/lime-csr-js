import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';
import { createStore, mount } from '../src/index.js';

const count = Number(process.argv[2] || 1000);
const dom = new JSDOM('<main id="app"></main>', { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;

const target = dom.window.document.getElementById('app');
const store = createStore({
  items: Array.from({ length: count }, (_, id) => ({ id, label: `Item ${id}` })),
});
const template = '<ul><for data-live each="items" as="item" key="item.id"><li data-on-click="select">${item.label}</li></for></ul>';
const handlers = { select() {} };

const started = performance.now();
const instance = mount({ target: target, template: template, store: store, ...{ handlers } });
const mounted = performance.now();
store.set('items', [...store.get('items')].reverse());
const updated = performance.now();
target.querySelector('li')?.click();
const dispatched = performance.now();
instance.unmount();

console.log(JSON.stringify({
  items: count,
  mountMs: +(mounted - started).toFixed(2),
  reorderMs: +(updated - mounted).toFixed(2),
  eventMs: +(dispatched - updated).toFixed(2),
}));
