import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const stages = [
  ['lint', ['run', 'lint']],
  ['typecheck', ['run', 'typecheck']],
  ['unit and regression tests', ['test']],
  ['distribution build', ['run', 'build']],
  ['built bundle smoke', ['run', 'test:browser']],
  ['strict CSP Chromium regression', ['run', 'test:csp']],
  ['example static validation', ['run', 'test:examples']],
  ['example Chromium smoke', ['run', 'test:examples:browser']],
  ['security Chromium regression', ['run', 'test:security:browser']],
  ['packed consumer exports', ['run', 'test:package']],
  ['external TypeScript consumer', ['run', 'test:package:types']],
  ['informational release benchmarks', ['run', 'benchmark:release']],
  ['dependency audit', ['audit']],
  ['package dry-run', ['pack', '--dry-run']],
];

for (const [name, args] of stages) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(npm, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Release verification could not start "${name}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Release verification failed at "${name}" with exit code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

console.log('\nRelease verification passed.');
