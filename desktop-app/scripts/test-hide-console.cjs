const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const { spawnSync } = require('node:child_process');

const preload = path.resolve(__dirname, '../runtime/hide-console.cjs');
const methods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
const calls = [];
const fakeChildProcess = {};
for (const name of methods) {
  fakeChildProcess[name] = (...args) => { calls.push({ name, args }); return 'result'; };
  if (name === 'exec' || name === 'execFile') {
    fakeChildProcess[name][promisify.custom] = (...args) => {
      calls.push({ name, args, promise: true });
      return Promise.resolve({ stdout: 'out', stderr: 'err' });
    };
  }
}
let esmSynced = false;
vm.runInNewContext(fs.readFileSync(preload, 'utf8'), {
  process: { platform: 'win32' },
  require(name) {
    if (name === 'node:child_process') return fakeChildProcess;
    if (name === 'node:module') return { syncBuiltinESMExports() { esmSynced = true; } };
    if (name === 'node:util') return { promisify };
    throw new Error(`Unexpected module: ${name}`);
  }
});
assert.equal(esmSynced, true);
const callback = () => {};
for (const name of methods) {
  const hasArgs = !name.startsWith('exec') || name.startsWith('execFile');
  const signatures = [[], [{ cwd: 'work', windowsHide: false }]];
  if (hasArgs) signatures.push([['--version']], [['--version'], { cwd: 'work' }]);
  if (name === 'exec' || name === 'execFile') {
    signatures.push([callback], [{ cwd: 'work' }, callback]);
    if (hasArgs) signatures.push([['--version'], callback]);
  }
  for (const suffix of signatures) {
    const originalOptions = suffix.find((v) => v && typeof v === 'object' && !Array.isArray(v));
    fakeChildProcess[name]('git', ...suffix);
    const { args } = calls.at(-1);
    const index = hasArgs && Array.isArray(args[1]) ? 2 : 1;
    assert.equal(args[index].windowsHide, true, name);
    if (originalOptions?.cwd) assert.equal(args[index].cwd, originalOptions.cwd);
    if (originalOptions) assert.notEqual(args[index], originalOptions);
    if (suffix.includes(callback)) assert.equal(args.at(-1), callback);
  }
}

(async () => {
  for (const name of ['exec', 'execFile']) {
    const result = await promisify(fakeChildProcess[name])('git', callback);
    assert.deepEqual(result, { stdout: 'out', stderr: 'err' });
    assert.equal(calls.at(-1).args[1].windowsHide, true);
    assert.equal(calls.at(-1).promise, true);
  }
  // Exercise named ESM imports, Promise semantics and inherited NODE_OPTIONS
  // against real Git, including a second-generation Node process.
  const nodeOptions = `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`.trim();
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { execFile, spawnSync } from 'node:child_process';
    import { promisify } from 'node:util';
    const pending = promisify(execFile)('git', ['--version']);
    assert.ok(pending.child.pid);
    assert.match((await pending).stdout, /git version/);
    const nested = spawnSync(process.execPath, ['-e',
      "const r=require('node:child_process').spawnSync('git',['--version'],{encoding:'utf8'});process.stdout.write(r.stdout);process.exit(r.status)"
    ], { encoding: 'utf8' });
    assert.equal(nested.status, 0, nested.stderr);
    assert.match(nested.stdout, /git version/);
  `], { env: { ...process.env, NODE_OPTIONS: nodeOptions }, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  console.log('PASS: process API overloads, hidden options, ESM, promisify and nested Git');
})().catch((error) => { console.error(error); process.exitCode = 1; });
