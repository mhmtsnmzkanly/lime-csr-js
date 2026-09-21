import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';
import { createStore, mount } from '../src/index.js';

const count = Number(process.argv[2] || 1000);
const iterations = Number(process.argv[3] || 5);
const diffStrategy = process.argv[4] || 'simple';
const scenario = process.argv[5] || 'reorder';

if (!Number.isInteger(count) || count < 1 || !Number.isInteger(iterations) || iterations < 1) {
  throw new TypeError('Items and iterations must be positive integers.');
}

const loopTemplate = `<ul><for data-live data-diff="${diffStrategy}" each="items" as="item" key="item.id"><li data-on-click="select">\${item.label}</li></for></ul>`;
const structuralTemplate = `<ul><for data-live data-diff="${diffStrategy}" each="items" as="item" key="item.id"><partial name="row"></partial></for></ul>`;
const textTemplate = '<span data-text="value"></span>';
const modelTemplate = '<input data-model="value">';
const appendTemplate = `<ul><for data-live data-diff="${diffStrategy}" each="items" as="item" key="item.id"><li>\${item.label}</li></for></ul>`;
const adminTableTemplate = `<table><tbody><template data-for each="items" as="item"><tr><td>\${item.id}</td><td><template data-if is-truthy="item.visible"><span>\${item.label}</span><template data-else><em>\${item.label}</em></template></template></td><td><button data-on-click="select">View</button><button data-on-click="select">Edit</button><button data-on-click="select">Delete</button></td></tr></template></tbody></table>`;
const structuralTemplates = {
  row: '<li data-on-click="select"><if is-truthy="item.visible"><span>${item.label}</span><else><em>${item.label}</em></else></if></li>',
};

const scenarios = {
  reorder: {
    template: loopTemplate,
    update: (store) => store.set('items', [...store.get('items')].reverse()),
    dispatch: (target) => target.querySelector('li')?.click(),
  },
  'item-update': {
    template: loopTemplate,
    update: (store) => {
      const itemIndex = Math.floor(count / 2);
      store.set('items', store.get('items').map((item, index) => (
        index === itemIndex ? { ...item, label: `${item.label} updated` } : item
      )));
    },
    dispatch: (target) => target.querySelector('li')?.click(),
  },
  'event-heavy': {
    template: loopTemplate,
    update: () => {},
    dispatch: (target) => target.querySelectorAll('li').forEach((element) => element.click()),
  },
  structural: {
    template: structuralTemplate,
    templates: structuralTemplates,
    update: (store) => store.set('items', [...store.get('items')].reverse()),
    dispatch: (target) => target.querySelector('li')?.click(),
  },
  'admin-table': {
    template: adminTableTemplate,
    update: () => {},
    dispatch: (target) => target.querySelectorAll('button').forEach((element) => element.click()),
  },
  'leaf-update': {
    template: textTemplate,
    state: () => ({ value: 'Initial' }),
    update: (store) => store.set('value', 'Updated'),
    dispatch: () => {},
  },
  'keyed-append': {
    template: appendTemplate,
    update: (store) => store.set('items', [
      ...store.get('items'),
      { id: count, label: `Item ${count}`, visible: true },
    ]),
    dispatch: () => {},
  },
  'model-update': {
    template: modelTemplate,
    state: () => ({ value: 'Initial' }),
    update: (_store, target) => {
      const input = target.querySelector('input');
      input.value = 'Updated';
      input.dispatchEvent(new target.ownerDocument.defaultView.Event('input', { bubbles: true }));
    },
    dispatch: () => {},
  },
};

const selectedScenario = scenarios[scenario];
if (!selectedScenario) {
  throw new RangeError(`Unknown scenario "${scenario}". Valid scenarios: ${Object.keys(scenarios).join(', ')}.`);
}

function runIteration() {
  const dom = new JSDOM('<main id="app"></main>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const target = dom.window.document.getElementById('app');
  const store = createStore(typeof selectedScenario.state === 'function' ? selectedScenario.state() : (selectedScenario.state || {
    items: Array.from({ length: count }, (_, id) => ({
      id,
      label: `Item ${id}`,
      visible: id % 2 === 0,
    })),
  }));
  const started = performance.now();
  const instance = mount({
    target,
    template: selectedScenario.template,
    templates: selectedScenario.templates,
    store,
    handlers: { select() {} },
  });
  const mounted = performance.now();
  selectedScenario.update(store, target);
  const updated = performance.now();
  selectedScenario.dispatch(target);
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
  scenario,
  mountMs: measurement('mountMs'),
  updateMs: measurement('reorderMs'),
  eventMs: measurement('eventMs'),
}));
