// Loaded before each desktop-managed Node service and inherited by its Node children.
// windowsHide on the service itself does not cover Git/npm/MCP grandchildren.
if (process.platform === 'win32') {
  const childProcess = require('node:child_process');
  const { syncBuiltinESMExports } = require('node:module');
  const { promisify } = require('node:util');

  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const original = childProcess[name];
    const hideOptions = (args) => {
      const index = !name.startsWith('exec') || name.startsWith('execFile')
        ? (Array.isArray(args[1]) ? 2 : 1)
        : 1;
      if (typeof args[index] === 'function') args.splice(index, 0, { windowsHide: true });
      else args[index] = { ...args[index], windowsHide: true };
      return args;
    };
    const wrapped = function (...args) {
      return Reflect.apply(original, this, hideOptions(args));
    };
    // exec/execFile have special Promise results ({stdout, stderr} and .child).
    // Preserve those semantics for SDKs that use util.promisify.
    if (original[promisify.custom]) {
      Object.defineProperty(wrapped, promisify.custom, {
        value: function (...args) {
          return Reflect.apply(original[promisify.custom], this, hideOptions(args));
        }
      });
    }
    childProcess[name] = wrapped;
  }
  // DSH and SnowLuma use named ESM imports of node:child_process.
  syncBuiltinESMExports();
}
