import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';
import { createStore, mount } from '../src/index.js';

const count = Number(process.argv[2] || 1000);
const iterations = Number(process.argv[3] || 5);
const diffStrategy = process.argv[4] || 'simple';
const template = `<ul><for data-live data-diff="${diffStrategy}" each="items" as="item" key="item.id"><li data-on-click="select">\${item.label}</li></for></ul>`;
const handlers = { select() {} };

function runIteration() {
  const dom = new JSDOM('<main id="app"></main>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = dom.window.document.getElementById('app');
  const store = createStore({
    items: Array.from({ length: count }, (_, id) => ({ id, label: `Item ${id}` })),
  });
  const started = performance.now();
  const instance = mount({ target, template, store, handlers });
  const mounted = performance.now();
  store.set('items', [...store.get('items')].reverse());
  const updated = performance.now();
  target.querySelector('li')?.click();
  const dispatched = performance.now();
  instance.unmount();
  return {
    mountMs: mounted - started,
    reorderMs: updated - mounted,
    eventMs: dispatched - updated,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

runIteration(); // Warm up JSDOM and module-level caches.
const samples = Array.from({ length: iterations }, runIteration);
const measurement = (key) => +median(samples.map((sample) => sample[key])).toFixed(2);

console.log(JSON.stringify({
  items: count,
  iterations,
  diffStrategy,
  mountMs: measurement('mountMs'),
  reorderMs: measurement('reorderMs'),
  eventMs: measurement('eventMs'),
}));
