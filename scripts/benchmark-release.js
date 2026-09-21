import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = path.join(root, 'scripts', 'benchmark.js');
const cases = [
  ['leaf-update', 'simple'],
  ['model-update', 'simple'],
  ['keyed-append', 'simple'],
  ['reorder', 'simple'],
  ['structural', 'lcs'],
];

console.log('Informational release benchmark (200 items, 3 median samples per case)');
for (const [scenario, strategy] of cases) {
  const output = execFileSync(process.execPath, [benchmark, '200', '3', strategy, scenario], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  console.log(output);
}
console.log('No hard timing threshold is enforced; compare these medians across release candidates.');
