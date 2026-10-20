const { app, BrowserWindow, Menu, dialog, shell, session, safeStorage, ipcMain } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

app.setName('DSBot 桌面端');

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();

let mainWindow = null;
let settingsWindow = null;
let roleWindow = null;
let serviceConsoleWindow = null;
let activeBridgeDataRoot = null;
let startupBusy = false;
let quitting = false;
let bridgeRestartMonitor = false;
let serviceChildren = new Map();
const serviceStarts = new Map();
const serviceActions = new Map();
let serviceMonitorTimer = null;
let serviceMonitorBusy = false;
const SERVICE_NAMES = new Set(['dsh', 'snowluma', 'bridge']);
let rememberPasswordForLogin = false;
const loginAttempts = new Map();
let services = {
  dsh: { label: 'DeepSeek Harness', port: 3080, status: 'checking', detail: '等待检查', actionLabel: '启动', updatedAt: 0 },
  snowluma: { label: 'SnowLuma', port: 5099, status: 'checking', detail: '等待检查', actionLabel: '启动', updatedAt: 0 },
  bridge: { label: 'QQ Bridge', port: 3100, status: 'checking', detail: '等待检查', actionLabel: '启动', updatedAt: 0 }
};

const USER_DATA = app.getPath('userData');
const PASSWORD_FILE = path.join(USER_DATA, 'snowluma-credential.bin');
const DESKTOP_SETTINGS_FILE = path.join(USER_DATA, 'desktop-settings.json');
const RUNTIME_SETUP_FILE = path.join(USER_DATA, 'runtime-setup.json');
const RUNTIME_BUNDLE_VERSION = app.getVersion();
const SNOWLUMA_URL = 'http://127.0.0.1:5099';
const SETTINGS_FILE = path.join(__dirname, 'settings.html');
const ROLE_WINDOW_FILE = path.join(__dirname, 'roles.html');
const SPLASH_FILE = path.join(__dirname, 'splash.html');
const PRELOAD_FILE = path.join(__dirname, 'preload.cjs');
// External Node cannot read Electron's app.asar. Package this preload as a resource.
const SERVICE_PRELOAD_FILE = app.isPackaged
  ? path.join(process.resourcesPath, 'hide-console.cjs')
  : path.join(__dirname, '..', 'runtime', 'hide-console.cjs');
const DEFAULT_RUNTIME_ROOT = path.join(USER_DATA, 'bundled-runtime', RUNTIME_BUNDLE_VERSION);
const DEFAULT_BRIDGE_ROOT = app.isPackaged
  ? path.join(DEFAULT_RUNTIME_ROOT, 'qq-bridge')
  : path.resolve(__dirname, '..', '..');

function readDesktopSettings() {
  try { return JSON.parse(fs.readFileSync(DESKTOP_SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}

function writeDesktopSettings(settings) {
  fs.mkdirSync(USER_DATA, { recursive: true });
  atomicWrite(DESKTOP_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

function runtimePaths() {
  const bridgeRoot = process.env.DSBOT_BRIDGE_ROOT || DEFAULT_BRIDGE_ROOT;
  const settings = readDesktopSettings();
  const root = app.isPackaged ? DEFAULT_RUNTIME_ROOT : path.resolve(bridgeRoot, '..');
  const snowlumaRoot = process.env.DSBOT_SNOWLUMA_ROOT || settings.snowlumaRoot || (app.isPackaged ? '' : path.join(root, 'SnowLuma'));
  const dataRoot = process.env.DSBOT_DATA_DIR || (app.isPackaged ? path.join(USER_DATA, 'bridge-data') : bridgeRoot);
  const bundledNode = path.join(root, 'node', 'node.exe');
  const nodeCandidates = app.isPackaged ? [bundledNode] : [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(snowlumaRoot, 'node.exe')
  ];
  const hasDshZstdSupport = (candidate) => {
    if (!fs.existsSync(candidate)) return false;
    const check = spawnSync(candidate, ['-e', "const z = require('node:zlib'); if (['createZstdDecompress', 'zstdCompress', 'zstdDecompress', 'zstdDecompressSync'].some((name) => typeof z[name] !== 'function')) process.exit(1)"], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return check.status === 0;
  };
  const nodeExe = nodeCandidates.find(hasDshZstdSupport) || nodeCandidates.find((candidate) => fs.existsSync(candidate));
  const npmRoot = path.join(process.env.APPDATA || '', 'npm');
  const dshHome = app.isPackaged ? path.join(USER_DATA, 'dsh-home') : (process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh'));
  return {
    root,
    bridgeRoot,
    dataRoot,
    stateRoot: path.join(dataRoot, 'state'),
    roleRoot: path.join(dataRoot, 'roles'),
    snowlumaRoot,
    nodeExe,
    dshHome,
    dshBin: app.isPackaged
      ? path.join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      : path.join(npmRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    dshSetup: path.join(bridgeRoot, 'scripts', 'setup-dsh.mjs'),
    dshCwd: dshHome,
    bridgeEntry: path.join(bridgeRoot, 'src', 'bridge.js'),
    bridgeLog: path.join(dataRoot, 'state', 'bridge.log'),
    bridgeToken: path.join(dataRoot, 'state', 'console-token'),
    configFile: path.join(dataRoot, 'config.json'),
    exampleConfig: path.join(bridgeRoot, 'config.example.json'),
    runtimeArchive: app.isPackaged ? path.join(process.resourcesPath, 'DSBot-runtime.zip') : '',
    runtimeRoot: root,
    defaultRoleRoot: path.join(bridgeRoot, 'roles'),
    runtimeLogRoot: path.join(USER_DATA, 'logs'),
    resolverRegister: app.isPackaged
      ? path.join(process.resourcesPath, 'register-snowluma-resolver.mjs')
      : path.join(__dirname, '..', 'runtime', 'register-snowluma-resolver.mjs')
  };
}

function updateService(name, status, detail, actionLabel) {
  if (!services[name]) return;
  const current = services[name];
  const nextActionLabel = actionLabel ?? current.actionLabel ?? '启动';
  if (current.status === status && current.detail === detail && current.actionLabel === nextActionLabel) return;
  services[name] = { ...current, status, detail, actionLabel: nextActionLabel, updatedAt: Date.now() };
  publishServiceState(detail);
}

function readCredentialRef(dshHome, refName) {
  if (!/^[A-Z0-9_]+$/.test(refName)) return '';
  let contents = '';
  try { contents = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8'); } catch { return ''; }
  if (contents.charCodeAt(0) === 0xFEFF) contents = contents.slice(1);
  let inRefs = false;
  for (const line of contents.split(/\r?\n/)) {
    if (!inRefs) {
      if (/^refs:\s*(?:#.*)?$/.test(line)) inRefs = true;
      continue;
    }
    if (line && !/^\s/.test(line) && !/^\s*#/.test(line)) break;
    const match = line.match(new RegExp(`^\\s+${refName}:\\s*(.*?)\\s*$`));
    if (!match) continue;
    let value = match[1];
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { return ''; }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    return typeof value === 'string' && !/[\r\n]/.test(value) ? value : '';
  }
  return '';
}

function serviceEnvironment(paths, serviceName = '') {
  const env = {
    ...process.env,
    DSBOT_BRIDGE_ROOT: paths.bridgeRoot,
    DSBOT_DATA_DIR: paths.dataRoot,
    DSBOT_CONFIG_FILE: paths.configFile,
    DSBOT_ROLE_DIR: paths.roleRoot,
    DSH_HOME: paths.dshHome,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS || '',
      `--require=${JSON.stringify(SERVICE_PRELOAD_FILE)}`,
      `--import=${pathToFileURL(paths.resolverRegister).href}`
    ].filter(Boolean).join(' ')
  };
  if (serviceName === 'dsh' && !env.DEEPSEEK_API_KEY) {
    const apiKey = readCredentialRef(paths.dshHome, 'DEEPSEEK_API_KEY');
    if (apiKey) {
      env.DEEPSEEK_API_KEY = apiKey;
      console.info('[desktop] DSH DeepSeek API credential loaded from the local DSH credential store.');
    }
  }
  return env;
}

function copyMissingFiles(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyMissingFiles(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function ensureDefaultBridgeConfig(paths) {
  if (fs.existsSync(paths.configFile)) return;
  const config = parseJsonFile(paths.exampleConfig);
  config.ownerQQ = null;
  config.allow = { ...(config.allow || {}), groups: [], private: [] };
  config.deny = { ...(config.deny || {}), groups: [], private: [] };
  config.consoleToken = '';
  config.snowluma = {
    ...(config.snowluma || {}),
    accessToken: '',
    wsAccessToken: '',
    httpAccessToken: '',
    launcherPath: '',
    homeDir: ''
  };
  atomicWrite(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
}

function ensureBundledRuntime(paths) {
  const readyFile = path.join(paths.runtimeRoot, '.bundle-ready');
  try {
    const marker = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    if (marker.version === RUNTIME_BUNDLE_VERSION && fs.existsSync(paths.nodeExe) && fs.existsSync(paths.bridgeEntry) && fs.existsSync(paths.dshBin)) return;
  } catch {}

  if (!fs.existsSync(paths.runtimeArchive)) throw new Error('安装包缺少 DSBot-runtime.zip 运行环境');
  const stagingRoot = `${paths.runtimeRoot}.staging`;
  fs.mkdirSync(path.dirname(paths.runtimeRoot), { recursive: true });
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  const result = spawnSync('tar.exe', ['-xf', paths.runtimeArchive, '-C', stagingRoot], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000
  });
  if (result.error || result.status !== 0) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    const details = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
    throw new Error(`解压桌面端运行环境失败${details ? `：\n${details}` : ''}`);
  }
  const extractedPaths = {
    nodeExe: path.join(stagingRoot, 'node', 'node.exe'),
    bridgeEntry: path.join(stagingRoot, 'qq-bridge', 'src', 'bridge.js'),
    dshBin: path.join(stagingRoot, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  };
  if (Object.values(extractedPaths).some((file) => !fs.existsSync(file))) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error('桌面端运行环境压缩包不完整，缺少 Node.js、DSH 或 QQ Bridge 文件');
  }
  atomicWrite(path.join(stagingRoot, '.bundle-ready'), `${JSON.stringify({ version: RUNTIME_BUNDLE_VERSION }, null, 2)}\n`);
  fs.rmSync(paths.runtimeRoot, { recursive: true, force: true });
  fs.renameSync(stagingRoot, paths.runtimeRoot);
}

function prepareUserRuntime(paths = runtimePaths()) {
  if (!app.isPackaged) return paths;
  ensureBundledRuntime(paths);
  paths = runtimePaths();
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  fs.mkdirSync(paths.stateRoot, { recursive: true });
  fs.mkdirSync(paths.dshHome, { recursive: true });
  fs.mkdirSync(paths.runtimeLogRoot, { recursive: true });
  ensureDefaultBridgeConfig(paths);
  copyMissingFiles(paths.defaultRoleRoot, paths.roleRoot);

  let marker = {};
  try { marker = JSON.parse(fs.readFileSync(RUNTIME_SETUP_FILE, 'utf8')); } catch {}
  if (marker.version === RUNTIME_BUNDLE_VERSION) return paths;
  if (!paths.nodeExe || !fs.existsSync(paths.dshSetup)) throw new Error('安装包缺少 Node.js 或 DSH 初始化文件');
  const result = spawnSync(paths.nodeExe, [paths.dshSetup, 'web'], {
    cwd: paths.bridgeRoot,
    env: serviceEnvironment(paths),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000
  });
  if (result.error || result.status !== 0) {
    const details = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
    throw new Error(`DSH 首次配置失败${details ? `：\n${details}` : ''}`);
  }
  atomicWrite(RUNTIME_SETUP_FILE, `${JSON.stringify({ version: RUNTIME_BUNDLE_VERSION }, null, 2)}\n`);
  return paths;
}

function serviceSnapshot(message) {
  return {
    services: Object.fromEntries(Object.entries(services).map(([name, service]) => [name, { ...service }])),
    snowlumaRoot: runtimePaths().snowlumaRoot,
    message: message || '自动监测中 · 每 5 秒检查一次'
  };
}

function publishServiceState(message) {
  const state = serviceSnapshot(message);
  for (const window of [mainWindow, serviceConsoleWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send('startup:update', state);
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('dsbot-control:service-update', state);
  }
}

function isSnowLumaUrl(value) {
  try { return new URL(value).origin === new URL(SNOWLUMA_URL).origin; }
  catch { return false; }
}

function canAccessSnowLuma(event) {
  const frameUrl = event.senderFrame?.url ?? '';
  return mainWindow && event.sender === mainWindow.webContents && isSnowLumaUrl(frameUrl);
}

function canAccessSettings(event) {
  const frameUrl = event.senderFrame?.url ?? '';
  return settingsWindow && event.sender === settingsWindow.webContents && frameUrl.startsWith('file:') && frameUrl.endsWith('/settings.html');
}

function canAccessRoleUi(event) {
  const frameUrl = event.senderFrame?.url ?? '';
  return roleWindow && !roleWindow.isDestroyed() && event.sender === roleWindow.webContents && frameUrl.startsWith('file:') && frameUrl.endsWith('/roles.html');
}

function canAccessStartupUi(event) {
  const frameUrl = event.senderFrame?.url ?? '';
  return [mainWindow, serviceConsoleWindow].some((window) =>
    window && !window.isDestroyed() && event.sender === window.webContents && frameUrl.startsWith('file:') && frameUrl.endsWith('/splash.html')
  );
}

function portIsOpen(port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function serviceLaunchConfig(name, paths = runtimePaths()) {
  if (!paths.nodeExe) return null;
  if (name === 'dsh') {
    return { port: 3080, executable: paths.nodeExe, args: [paths.dshBin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '3080'], cwd: paths.dshCwd, timeoutMs: 10000, requiredPath: paths.dshBin };
  }
  if (name === 'snowluma') {
    return { port: 5099, executable: paths.nodeExe, args: ['index.mjs'], cwd: paths.snowlumaRoot, timeoutMs: 18000, requiredPath: paths.snowlumaRoot ? path.join(paths.snowlumaRoot, 'index.mjs') : '' };
  }
  if (name === 'bridge') {
    return { port: 3100, executable: paths.nodeExe, args: [paths.bridgeEntry], cwd: paths.bridgeRoot, timeoutMs: 10000, requiredPath: paths.bridgeEntry };
  }
  return null;
}

function listeningProcesses(port) {
  if (process.platform !== 'win32') return null;
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) return null;
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$owners = @(Get-NetTCPConnection -State Listen -LocalPort ${safePort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)`,
    '$items = @()',
    'foreach ($owner in $owners) { $item = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$owner); if ($item) { $items += [pscustomobject]@{ processId = $item.ProcessId; executablePath = $item.ExecutablePath; commandLine = $item.CommandLine } } }',
    '$json = ConvertTo-Json -InputObject @($items) -Compress',
    '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.error || result.status !== 0) return null;
  const output = String(result.stdout || '').trim();
  if (!output) return [];
  try {
    const parsed = JSON.parse(Buffer.from(output, 'base64').toString('utf8'));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function normalizedWindowsPath(value) {
  if (!value) return '';
  return path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase();
}

function isExpectedServiceProcess(processInfo, command) {
  const executablePath = normalizedWindowsPath(processInfo?.executablePath);
  const commandLine = String(processInfo?.commandLine || '').replace(/\//g, '\\').toLowerCase();
  const requiredPath = normalizedWindowsPath(command?.requiredPath);
  return Boolean(executablePath && commandLine && requiredPath
    && executablePath === normalizedWindowsPath(command.executable)
    && commandLine.includes(requiredPath));
}

function isStaleBundledServiceProcess(name, processInfo, command) {
  if (!['dsh', 'bridge'].includes(name)) return false;
  const executablePath = normalizedWindowsPath(processInfo?.executablePath);
  const expectedExecutable = normalizedWindowsPath(command?.executable);
  const bundledRuntimeRoot = normalizedWindowsPath(path.join(USER_DATA, 'bundled-runtime')) + path.sep;
  const commandLine = String(processInfo?.commandLine || '').replace(/\//g, '\\').toLowerCase();
  if (!executablePath || !expectedExecutable || executablePath === expectedExecutable
      || !executablePath.startsWith(bundledRuntimeRoot)) return false;
  const entryMarker = name === 'dsh'
    ? '\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
    : '\\qq-bridge\\src\\bridge.js';
  return commandLine.includes(entryMarker);
}

function stopProcessTree(processId) {
  if (process.platform !== 'win32' || !Number.isInteger(Number(processId)) || Number(processId) <= 0) return false;
  const result = spawnSync('taskkill.exe', ['/PID', String(Number(processId)), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 10000
  });
  return !result.error && result.status === 0;
}

async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (!(await portIsOpen(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return !quitting && !(await portIsOpen(port));
}

async function ensureConfiguredService(name, paths = runtimePaths()) {
  const active = serviceStarts.get(name);
  if (active) return active;
  const command = serviceLaunchConfig(name, paths);
  if (!command) {
    updateService(name, 'error', '找不到 Node.js；请检查本机运行环境');
    return false;
  }
  if (name === 'snowluma' && !paths.snowlumaRoot) {
    updateService(name, 'error', '尚未选择 SnowLuma 安装文件夹', '选择目录');
    return false;
  }
  if (!fs.existsSync(command.requiredPath)) {
    updateService(name, 'error', `找不到服务文件：${command.requiredPath}`);
    return false;
  }
  if (await portIsOpen(command.port)) {
    if (process.platform !== 'win32') {
      updateService(name, 'online', `服务正常响应 · 127.0.0.1:${command.port}`, '启动');
      return true;
    }
    const listeners = listeningProcesses(command.port);
    if (!listeners) {
      updateService(name, 'error', `无法核验端口 ${command.port} 对应的后台进程`);
      return false;
    }
    if (listeners.some((item) => isExpectedServiceProcess(item, command))) {
      updateService(name, 'online', `服务正常响应 · 127.0.0.1:${command.port}`, '启动');
      return true;
    }
    const staleProcesses = name === 'snowluma' ? [] : listeners.filter((item) => isStaleBundledServiceProcess(name, item, command));
    if (staleProcesses.length && staleProcesses.length === listeners.length) {
      console.info(`[desktop] ${name} 检测到旧版桌面运行时，正在停止旧进程并启动当前版本。`);
      for (const item of staleProcesses) stopProcessTree(item.processId);
      if (!(await waitForPortClosed(command.port, 10000))) {
        updateService(name, 'error', `旧版后台仍占用端口 ${command.port}，请重启桌面端`);
        return false;
      }
    } else {
      updateService(name, 'online', `服务正常响应 · 127.0.0.1:${command.port}`, '启动');
      return true;
    }
  }
  const task = ensureService(name, command.port, command.executable, command.args, command.cwd, command.timeoutMs);
  serviceStarts.set(name, task);
  try { return await task; }
  finally { if (serviceStarts.get(name) === task) serviceStarts.delete(name); }
}

async function refreshServiceStatus() {
  if (serviceMonitorBusy || quitting) return;
  serviceMonitorBusy = true;
  try {
    const entries = Object.entries(services);
    const [availability, oneBotReady] = await Promise.all([
      Promise.all(entries.map(async ([name, service]) => [name, await portIsOpen(service.port)])),
      portIsOpen(3001)
    ]);
    for (const [name, ready] of availability) {
      const current = services[name];
      if (ready) {
        updateService(name, 'online', `服务正常响应 · 127.0.0.1:${current.port}`, '启动');
        continue;
      }
      if (current.status === 'starting' && Date.now() - (current.updatedAt || 0) < 15000) continue;
      if ((current.status === 'checking' || current.status === 'starting') && startupBusy) continue;
      if (name === 'bridge' && !oneBotReady) {
        updateService(name, 'error', 'QQ OneBot 尚未连接；请先在 SnowLuma 登录 QQ', '打开登录页');
      } else {
        updateService(name, 'error', `服务未运行 · 127.0.0.1:${current.port} 无响应`, '启动');
      }
    }
    publishServiceState();
  } finally {
    serviceMonitorBusy = false;
  }
}

function startServiceMonitor() {
  if (serviceMonitorTimer) return;
  refreshServiceStatus().catch((error) => console.error('[desktop] 服务状态检查失败:', error?.message ?? error));
  serviceMonitorTimer = setInterval(() => {
    refreshServiceStatus().catch((error) => console.error('[desktop] 服务状态检查失败:', error?.message ?? error));
  }, 5000);
  serviceMonitorTimer.unref?.();
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (await portIsOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return !quitting && portIsOpen(port);
}

function logFileFor(service, stream) {
  const { runtimeLogRoot } = runtimePaths();
  fs.mkdirSync(runtimeLogRoot, { recursive: true });
  return path.join(runtimeLogRoot, `${service}-${stream}.log`);
}

function spawnBackground(name, executable, args, cwd) {
  if (!fs.existsSync(SERVICE_PRELOAD_FILE)) throw new Error('缺少后台服务窗口控制模块，请重新安装桌面端');
  const serviceEnv = serviceEnvironment(runtimePaths(), name);
  const outFd = fs.openSync(logFileFor(name, 'out'), 'a');
  const errFd = fs.openSync(logFileFor(name, 'err'), 'a');
  let child;
  try {
    child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: serviceEnv
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  serviceChildren.set(name, child);
  child.once('error', (error) => {
    updateService(name, 'error', `启动失败：${error.message}`);
  });
  child.once('exit', (code) => {
    if (serviceChildren.get(name) === child) serviceChildren.delete(name);
    if (!quitting) {
      updateService(name, 'error', `进程提前退出（代码 ${code ?? '未知'}）`);
    }
  });
  child.unref();
  return child;
}

async function ensureService(name, port, executable, args, cwd, timeoutMs) {
  updateService(name, 'checking', `检查 127.0.0.1:${port}`);
  if (await portIsOpen(port)) {
    updateService(name, 'error', `端口 ${port} 在启动前被其他进程占用`);
    return false;
  }
  if (!executable || !fs.existsSync(executable)) {
    updateService(name, 'error', `找不到服务文件：${executable || 'Node.js'}`);
    return false;
  }
  if (name === 'snowluma') {
    const paths = runtimePaths();
    const versionCheck = spawnSync(executable, [path.join(paths.snowlumaRoot, 'check-node-version.cjs')], {
      cwd: paths.snowlumaRoot,
      windowsHide: true,
      encoding: 'utf8'
    });
    if (versionCheck.error || versionCheck.status !== 0) {
      updateService(name, 'error', (versionCheck.stderr || versionCheck.error?.message || 'Node.js 版本检查失败').trim());
      return false;
    }
  }
  updateService(name, 'starting', '正在后台启动');
  try {
    spawnBackground(name, executable, args, cwd);
  } catch (error) {
    updateService(name, 'error', `启动失败：${error.message}`);
    return false;
  }
  const ready = await waitForPort(port, timeoutMs);
  if (!ready && services[name].status === 'error') return false;
  updateService(name, ready ? 'online' : 'starting', ready ? '服务已就绪' : '仍在启动；稍后可重试');
  return ready;
}

async function startManagedServiceInternal(name) {
  const paths = runtimePaths();
  if (name === 'bridge') {
    if (!(await ensureConfiguredService('dsh', paths))) {
      updateService('bridge', 'error', 'DeepSeek Harness 未就绪；请先启动 DSH', '启动');
      return false;
    }
    if (!(await portIsOpen(5099))) {
      const snowlumaReady = await ensureConfiguredService('snowluma', paths);
      if (!snowlumaReady) {
        updateService('bridge', 'error', 'SnowLuma 尚未启动，QQ Bridge 无法连接', '启动');
        return false;
      }
      await openSnowLumaWorkspace();
    }
    if (!(await portIsOpen(3001))) {
      updateService('bridge', 'error', 'QQ OneBot 尚未连接；请先登录 QQ，再点击启动', '打开登录页');
      await openSnowLumaWorkspace();
      return false;
    }
  }

  const ready = await ensureConfiguredService(name, paths);
  if (name === 'snowluma' && ready) await openSnowLumaWorkspace();
  return ready;
}

function startManagedService(name) {
  if (!SERVICE_NAMES.has(name)) return Promise.reject(new Error('未知的服务名称'));
  const active = serviceActions.get(name);
  if (active) return active;
  const task = startManagedServiceInternal(name).then((ok) => ({
    ok,
    service: name,
    status: services[name].status,
    detail: services[name].detail
  })).finally(() => {
    if (serviceActions.get(name) === task) serviceActions.delete(name);
  });
  serviceActions.set(name, task);
  return task;
}

async function startAllServices() {
  if (startupBusy) return;
  startupBusy = true;
  let paths = runtimePaths();

  try {
    paths = prepareUserRuntime(paths) || paths;
    paths = runtimePaths();
    const nodeExe = paths.nodeExe;
    if (!nodeExe) {
      updateService('dsh', 'error', `找不到随桌面端安装的 Node.js：${nodeExe || 'resources\\node\\node.exe'}`);
      updateService('snowluma', 'error', paths.snowlumaRoot ? 'SnowLuma 运行环境未就绪' : '请先选择 SnowLuma 安装文件夹', paths.snowlumaRoot ? '启动' : '选择目录');
      updateService('bridge', 'error', 'Node.js 运行环境未就绪，无法启动 QQ Bridge');
      return;
    }
    const dshReady = await ensureConfiguredService('dsh', paths);
    if (quitting) return;

    const snowlumaReady = await ensureConfiguredService('snowluma', paths);
    if (await portIsOpen(5099) && mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(SNOWLUMA_URL);
    }
    if (quitting) return;

    const oneBotReady = await portIsOpen(3001);
    if (!dshReady) {
      updateService('bridge', 'error', 'DeepSeek Harness 未就绪；请先启动 DSH', '启动');
    } else if (!snowlumaReady) {
      updateService('bridge', 'error', 'SnowLuma 尚未启动，QQ Bridge 无法连接', '启动');
    } else if (oneBotReady) {
      await ensureConfiguredService('bridge', paths);
    } else {
      updateService('bridge', 'error', 'QQ OneBot 尚未连接；请先在 SnowLuma 登录 QQ', '打开登录页');
    }
  } catch (error) {
    updateService('dsh', 'error', error.message);
    updateService('bridge', 'error', '本机运行环境初始化失败');
  } finally {
    startupBusy = false;
  }
}

async function openSnowLumaWorkspace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(SNOWLUMA_URL);
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f8fa',
    title: 'DSBot 桌面端',
    webPreferences: {
      preload: PRELOAD_FILE,
      partition: 'persist:dsbot-snowluma',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(SPLASH_FILE);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isSnowLumaUrl(url)) return;
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    event.preventDefault();
  });
  mainWindow.webContents.on('did-finish-load', async () => {
    if (!mainWindow) return;
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl.startsWith('file:') && currentUrl.endsWith('/splash.html')) {
      mainWindow.webContents.send('startup:update', { services, message: '正在准备服务…' });
      return;
    }
    if (!isSnowLumaUrl(currentUrl)) return;
    try {
      if (fs.existsSync(PASSWORD_FILE) && await safeStorage.isAsyncEncryptionAvailable()) {
        const encrypted = fs.readFileSync(PASSWORD_FILE);
        const decrypted = await safeStorage.decryptStringAsync(encrypted);
        if (decrypted.shouldReEncrypt) {
          atomicWrite(PASSWORD_FILE, await safeStorage.encryptStringAsync(decrypted.result));
        }
        mainWindow.webContents.send('credential:autofill', { saved: true, password: decrypted.result });
      } else {
        mainWindow.webContents.send('credential:autofill', { saved: false, password: '' });
      }
    } catch {
      mainWindow.webContents.send('credential:autofill', { saved: false, password: '' });
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 880,
    minWidth: 820,
    minHeight: 660,
    parent: mainWindow ?? undefined,
    title: '机器人参数',
    backgroundColor: '#f4f8fa',
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  settingsWindow.loadFile(SETTINGS_FILE);
  settingsWindow.on('closed', () => { settingsWindow = null; });
  return settingsWindow;
}

function createRoleWindow() {
  if (roleWindow && !roleWindow.isDestroyed()) {
    roleWindow.show();
    roleWindow.focus();
    return roleWindow;
  }
  roleWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 820,
    minHeight: 620,
    parent: mainWindow ?? undefined,
    title: '角色卡切换 · DSBot',
    backgroundColor: '#f4f8fa',
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  roleWindow.loadFile(ROLE_WINDOW_FILE);
  roleWindow.on('closed', () => { roleWindow = null; });
  return roleWindow;
}

function createServiceConsoleWindow() {
  if (serviceConsoleWindow && !serviceConsoleWindow.isDestroyed()) {
    serviceConsoleWindow.show();
    serviceConsoleWindow.focus();
    publishServiceState();
    return serviceConsoleWindow;
  }
  serviceConsoleWindow = new BrowserWindow({
    width: 820,
    height: 660,
    minWidth: 660,
    minHeight: 540,
    show: false,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    title: '本机服务控制台',
    backgroundColor: '#f4f8fa',
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  const window = serviceConsoleWindow;
  window.webContents.once('did-finish-load', () => publishServiceState());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (serviceConsoleWindow === window) serviceConsoleWindow = null; });
  window.loadFile(SPLASH_FILE);
  return window;
}

function createMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'DSBot',
      submenu: [
        { label: '角色卡切换…', click: () => createRoleWindow() },
        { label: '机器人参数…', accelerator: 'Ctrl+,', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: '退出（后台服务继续运行）', role: 'quit' }
      ]
    },
    {
      label: '服务',
      submenu: [
        { label: '打开服务状态控制台', click: () => createServiceConsoleWindow() },
        { type: 'separator' },
        { label: '选择 SnowLuma 安装文件夹', click: () => selectSnowLumaDirectory().catch((error) => dialog.showErrorBox('SnowLuma 路径设置失败', error.message)) },
        { label: '重新加载 SnowLuma', click: () => mainWindow?.loadURL(SNOWLUMA_URL) },
        { label: '重启 QQ Bridge', click: () => restartBridgeFromMenu() },
        { label: '打开运行日志目录', click: () => shell.openPath(runtimePaths().runtimeLogRoot) }
      ]
    },
    {
      label: '关于',
      submenu: [
        { label: '关于 DSBot 桌面端', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'DSBot 桌面端', message: 'DSBot 桌面端', detail: 'Electron 桌面启动器；SnowLuma 页面由本机已安装的 SnowLuma 服务提供。' }) },
        { label: 'SnowLuma 许可与说明', click: () => shell.openPath(path.join(runtimePaths().snowlumaRoot, 'EULA.md')) }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function parseJsonFile(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function configFile() {
  return runtimePaths().configFile;
}

function pickConfigSettings(config) {
  const wake = config.socialV2?.wake ?? {};
  const send = config.socialV2?.send ?? {};
  const proactive = config.socialV2?.proactive ?? {};
  const context = config.socialV2?.context ?? {};
  return {
    model: String(config.dsh?.model ?? 'deepseek-flash'),
    reasoningEffort: String(config.dsh?.reasoningEffort ?? 'medium'),
    socialEnabled: config.socialV2?.enabled !== false,
    autoReplyCheckMs: Number(config.socialV2?.autoReplyCheckMs ?? 30000),
    wakeDefaultMode: wake.defaultMode === 'active' ? 'active' : 'diving',
    wakeProbability: Number(wake.recommendedProbability ?? 0.35),
    preSleepWaitEnabled: wake.preSleepWaitEnabled !== false,
    preSleepWaitMs: Number(wake.preSleepWaitMs ?? 300000),
    maxWakePerMinute: Number(wake.maxWakePerMinute ?? 2),
    maxWakePerHour: Number(wake.maxWakePerHour ?? 30),
    burstEnabled: send.burstEnabled !== false,
    burstIntervalMinMs: Number(send.burstIntervalMinMs ?? 1000),
    burstIntervalMaxMs: Number(send.burstIntervalMaxMs ?? 3000),
    maxSendPerMinute: Number(send.maxSendPerMinute ?? 12),
    maxMessageChars: Number(send.maxMessageChars ?? 500),
    proactiveEnabled: proactive.enabled !== false,
    proactiveProbability: Number(proactive.probability ?? 0.3),
    proactiveIdleThresholdMs: Number(proactive.idleThresholdMs ?? 900000),
    recentLimit: Number(context.recentLimit ?? 100),
    contextWindow: Number(context.contextWindow ?? 20),
    unreadLimit: Number(context.unreadLimit ?? 30)
  };
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('参数格式无效');
  const effortValues = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  const modeValues = new Set(['diving', 'active']);
  const model = String(input.model ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new Error('模型名称只能包含字母、数字、点、下划线、冒号和连字符');
  if (!effortValues.has(input.reasoningEffort)) throw new Error('推理档位无效');
  if (!modeValues.has(input.wakeDefaultMode)) throw new Error('默认聊天状态无效');
  for (const key of ['socialEnabled', 'preSleepWaitEnabled', 'burstEnabled', 'proactiveEnabled']) {
    if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`);
  }
  const limits = {
    autoReplyCheckMs: [1000, 600000, true],
    wakeProbability: [0, 1, false],
    preSleepWaitMs: [10000, 1800000, true],
    maxWakePerMinute: [0, 60, true],
    maxWakePerHour: [0, 1000, true],
    burstIntervalMinMs: [0, 60000, true],
    burstIntervalMaxMs: [0, 120000, true],
    maxSendPerMinute: [1, 120, true],
    maxMessageChars: [50, 4000, true],
    proactiveProbability: [0, 1, false],
    proactiveIdleThresholdMs: [60000, 86400000, true],
    recentLimit: [10, 500, true],
    unreadLimit: [1, 500, true],
    contextWindow: [4, 100, true]
  };
  const result = { model, reasoningEffort: input.reasoningEffort, wakeDefaultMode: input.wakeDefaultMode };
  for (const key of ['socialEnabled', 'preSleepWaitEnabled', 'burstEnabled', 'proactiveEnabled']) result[key] = input[key];
  for (const [key, [min, max, integer]] of Object.entries(limits)) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`${key} 超出允许范围（${min}–${max}）`);
    }
    result[key] = value;
  }
  if (result.burstIntervalMinMs > result.burstIntervalMaxMs) throw new Error('分条最小间隔不能大于最大间隔');
  return result;
}

function updateConfigFromSettings(settings) {
  const filePath = configFile();
  const config = parseJsonFile(filePath);
  config.dsh ??= {};
  config.socialV2 ??= {};
  config.socialV2.wake ??= {};
  config.socialV2.send ??= {};
  config.socialV2.proactive ??= {};
  config.socialV2.context ??= {};
  config.dsh.model = settings.model;
  config.dsh.reasoningEffort = settings.reasoningEffort;
  config.socialV2.enabled = settings.socialEnabled;
  config.socialV2.autoReplyCheckMs = settings.autoReplyCheckMs;
  Object.assign(config.socialV2.wake, {
    defaultMode: settings.wakeDefaultMode,
    recommendedProbability: settings.wakeProbability,
    preSleepWaitEnabled: settings.preSleepWaitEnabled,
    preSleepWaitMs: settings.preSleepWaitMs,
    maxWakePerMinute: settings.maxWakePerMinute,
    maxWakePerHour: settings.maxWakePerHour,
    recommendedAtMention: true,
    recommendedQuestion: true,
    recommendedNameMention: true
  });
  Object.assign(config.socialV2.send, {
    burstEnabled: settings.burstEnabled,
    burstIntervalMinMs: settings.burstIntervalMinMs,
    burstIntervalMaxMs: settings.burstIntervalMaxMs,
    maxSendPerMinute: settings.maxSendPerMinute,
    maxMessageChars: settings.maxMessageChars
  });
  Object.assign(config.socialV2.proactive, {
    enabled: settings.proactiveEnabled,
    probability: settings.proactiveProbability,
    idleThresholdMs: settings.proactiveIdleThresholdMs
  });
  Object.assign(config.socialV2.context, {
    recentLimit: settings.recentLimit,
    unreadLimit: settings.unreadLimit,
    contextWindow: settings.contextWindow
  });
  atomicWrite(filePath, `${JSON.stringify(config, null, 2)}\n`);
  return pickConfigSettings(config);
}

async function savePassword(password, remember) {
  if (!remember) {
    try { fs.rmSync(PASSWORD_FILE, { force: true }); } catch {}
    return;
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 4096) return;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统密码加密不可用，未保存密码');
  const encrypted = await safeStorage.encryptStringAsync(password);
  atomicWrite(PASSWORD_FILE, encrypted);
}

function installSnowLumaCredentialHooks() {
  const snowSession = session.fromPartition('persist:dsbot-snowluma');
  const filter = { urls: ['http://127.0.0.1:5099/api/login'] };
  snowSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    try {
      if (details.method === 'POST' && mainWindow && details.webContentsId === mainWindow.webContents.id) {
        const bytes = (details.uploadData ?? []).filter((part) => part.bytes).map((part) => Buffer.from(part.bytes));
        const body = Buffer.concat(bytes).toString('utf8');
        const password = JSON.parse(body).password;
        if (typeof password === 'string') {
          loginAttempts.set(details.id, { password, remember: rememberPasswordForLogin });
        }
      }
    } catch {}
    callback({});
  });
  snowSession.webRequest.onCompleted(filter, (details) => {
    const attempt = loginAttempts.get(details.id);
    loginAttempts.delete(details.id);
    if (!attempt || details.statusCode < 200 || details.statusCode >= 400) return;
    savePassword(attempt.password, attempt.remember)
      .then(() => mainWindow?.webContents.send('credential:save-result', { ok: true, saved: attempt.remember }))
      .catch((error) => mainWindow?.webContents.send('credential:save-result', { ok: false, message: error.message }));
  });
  snowSession.webRequest.onErrorOccurred(filter, (details) => loginAttempts.delete(details.id));
}

async function restartBridgeAfterRequestedShutdown() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (quitting) return;
    if (!(await portIsOpen(3100))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (await portIsOpen(3100)) throw new Error('Bridge 重启后仍未释放 3100 端口');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (quitting) return;
  const paths = runtimePaths();
  if (!paths.nodeExe || !fs.existsSync(paths.bridgeEntry)) throw new Error('找不到 Node.js 或 QQ Bridge 启动文件');
  await ensureService('bridge', 3100, paths.nodeExe, [paths.bridgeEntry], paths.bridgeRoot, 10000);
}

async function restartBridge() {
  const paths = runtimePaths();
  let token = '';
  try { token = fs.readFileSync(paths.bridgeToken, 'utf8').trim(); } catch {}
  if (!token) throw new Error('找不到 Bridge 管理令牌；请先启动 QQ Bridge');
  const response = await fetch('http://127.0.0.1:3100/api/restart', {
    method: 'POST',
    headers: { 'x-console-token': token }
  });
  if (!response.ok) throw new Error(`QQ Bridge 重启请求失败（HTTP ${response.status}）`);
  if (!bridgeRestartMonitor) {
    bridgeRestartMonitor = true;
    restartBridgeAfterRequestedShutdown()
      .catch((error) => updateService('bridge', 'error', `重启失败：${error.message}`))
      .finally(() => { bridgeRestartMonitor = false; });
  }
  return { ok: true, message: '配置已保存，QQ Bridge 正在重启。' };
}

async function bridgeApiRequest(route, method = 'GET', body) {
  const paths = runtimePaths();
  const tokenFiles = [...new Set([
    paths.bridgeToken,
    path.join(paths.bridgeRoot, 'state', 'console-token')
  ])];
  const tokens = tokenFiles.flatMap((file, index) => {
    try {
      const token = fs.readFileSync(file, 'utf8').trim();
      return token ? [{ token, dataRoot: index === 0 ? paths.dataRoot : paths.bridgeRoot }] : [];
    } catch { return []; }
  });
  if (!tokens.length) throw new Error('找不到 Bridge 管理令牌；请先启动 QQ Bridge');

  let response;
  for (let index = 0; index < tokens.length; index += 1) {
    response = await fetch(`http://127.0.0.1:3100${route}`, {
      method,
      headers: {
        'x-console-token': tokens[index].token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (response.status !== 401 || index === tokens.length - 1) {
      activeBridgeDataRoot = tokens[index].dataRoot;
      break;
    }
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`QQ Bridge 返回了无法解析的数据（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(result.error || `QQ Bridge 请求失败（HTTP ${response.status}）`);
  return result;
}

async function loadRoleManagerData() {
  const [roleData, sessionData] = await Promise.all([
    bridgeApiRequest('/api/roles'),
    bridgeApiRequest('/api/sessions')
  ]);
  const paths = runtimePaths();
  const roleRoots = [...new Set([
    activeBridgeDataRoot && path.join(activeBridgeDataRoot, 'roles'),
    paths.roleRoot,
    paths.defaultRoleRoot
  ].filter(Boolean).map((root) => path.resolve(root)))];
  const roles = (Array.isArray(roleData.roles) ? roleData.roles : []).map((name) => {
    for (const roleRoot of roleRoots) {
      const roleFile = path.resolve(roleRoot, `${name}.md`);
      if (path.dirname(roleFile) !== roleRoot) continue;
      try { return { name, content: fs.readFileSync(roleFile, 'utf8') }; }
      catch {}
    }
    return { name, content: '' };
  });
  return {
    roles,
    sessions: Array.isArray(sessionData.sessions) ? sessionData.sessions : []
  };
}

async function saveRoleCard(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const content = typeof input?.content === 'string' ? input.content : '';
  const expectedContent = typeof input?.expectedContent === 'string' ? input.expectedContent : null;
  if (!/^[\w\u4e00-\u9fff-]+$/u.test(name) || name === 'README') {
    throw new Error('角色卡名称无效');
  }
  if (expectedContent === null) throw new Error('缺少原始内容校验，请重新打开角色卡');
  if (!content.trim()) throw new Error('角色卡内容不能为空');
  if (content.length > 200_000) throw new Error('角色卡内容不能超过 200,000 个字符');

  const { roles } = await bridgeApiRequest('/api/roles');
  if (!Array.isArray(roles) || !roles.includes(name)) throw new Error('该角色卡已不存在，请刷新列表');

  const paths = runtimePaths();
  const roleRoot = path.resolve(activeBridgeDataRoot || paths.dataRoot, 'roles');
  const roleFile = path.resolve(roleRoot, `${name}.md`);
  if (path.dirname(roleFile) !== roleRoot) throw new Error('角色卡路径无效');
  if (!fs.existsSync(roleFile)) throw new Error('角色卡文件不存在，请刷新列表');
  if (fs.readFileSync(roleFile, 'utf8') !== expectedContent) {
    throw new Error('角色卡已在其他位置修改，请刷新列表后重试');
  }

  atomicWrite(roleFile, `${content}${content.endsWith('\n') ? '' : '\n'}`);
  return { name, content: fs.readFileSync(roleFile, 'utf8') };
}

async function switchSessionRole(input) {
  const key = typeof input?.key === 'string' ? input.key : '';
  if (!/^(group|private):\d+$/.test(key)) throw new Error('会话格式无效，请重新选择群或私聊');
  const role = input?.role === null ? null : (typeof input?.role === 'string' ? input.role : '');
  if (role !== null) {
    if (!/^[\w\u4e00-\u9fff-]+$/.test(role)) throw new Error('角色名格式无效');
    const { roles } = await bridgeApiRequest('/api/roles');
    if (!roles.includes(role)) throw new Error('该角色卡已不存在，请刷新列表');
  }
  return bridgeApiRequest('/api/role', 'POST', { key, role });
}

async function selectSnowLumaDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 SnowLuma 安装文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selected = path.resolve(result.filePaths[0]);
  if (!fs.existsSync(path.join(selected, 'index.mjs'))) {
    throw new Error('所选文件夹中没有 index.mjs，请选择 SnowLuma 的安装根目录。');
  }
  writeDesktopSettings({ ...readDesktopSettings(), snowlumaRoot: selected });
  updateService('snowluma', 'checking', `已选择 SnowLuma：${selected}`);
  while (startupBusy && !quitting) await new Promise((resolve) => setTimeout(resolve, 150));
  await startAllServices();
  return { ok: true, path: selected };
}

function registerIpc() {
  ipcMain.on('credential:remember-option', (event, value) => {
    if (!canAccessSnowLuma(event)) return;
    rememberPasswordForLogin = value === true;
  });

  ipcMain.on('startup:open-settings', (event) => {
    if (!canAccessStartupUi(event)) return;
    createSettingsWindow();
  });

  ipcMain.handle('startup:select-snowluma-directory', async (event) => {
    if (!canAccessStartupUi(event)) throw new Error('未授权的服务控制台');
    return selectSnowLumaDirectory();
  });

  ipcMain.handle('settings:load', (event) => {
    if (!canAccessSettings(event)) throw new Error('未授权的设置窗口');
    return pickConfigSettings(parseJsonFile(configFile()));
  });

  ipcMain.handle('settings:save-and-apply', async (event, input) => {
    if (!canAccessSettings(event)) throw new Error('未授权的设置窗口');
    const safeSettings = validateSettings(input);
    const saved = updateConfigFromSettings(safeSettings);
    let restart;
    try { restart = await restartBridge(); }
    catch (error) { restart = { ok: false, message: `配置已保存；重启服务失败：${error.message}` }; }
    return { ok: true, settings: saved, restart };
  });

  ipcMain.handle('settings:restart-bridge', async (event) => {
    if (!canAccessSettings(event)) throw new Error('未授权的设置窗口');
    return restartBridge();
  });

  ipcMain.handle('startup:retry', (event) => {
    if (!canAccessStartupUi(event)) throw new Error('未授权的服务控制台');
    return startAllServices();
  });

  ipcMain.handle('startup:start-service', (event, name) => {
    if (!canAccessStartupUi(event)) throw new Error('未授权的服务控制台');
    return startManagedService(name);
  });

  ipcMain.handle('dsbot-control:get-services', (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    return serviceSnapshot();
  });

  ipcMain.handle('dsbot-control:refresh-services', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    await refreshServiceStatus();
    return serviceSnapshot();
  });

  ipcMain.handle('dsbot-control:start-service', (event, name) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    return startManagedService(name);
  });

  ipcMain.handle('dsbot-control:start-all', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    await startAllServices();
    return serviceSnapshot();
  });

  ipcMain.handle('dsbot-control:open-settings', (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    createSettingsWindow();
    return { ok: true, message: '已打开机器人参数' };
  });

  ipcMain.handle('dsbot-control:open-roles', (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    createRoleWindow();
    return { ok: true, message: '已打开角色卡页面' };
  });

  ipcMain.handle('dsbot-control:reload-snowluma', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    await mainWindow.loadURL(SNOWLUMA_URL);
    return { ok: true, message: 'SnowLuma 已重新加载' };
  });

  ipcMain.handle('dsbot-control:restart-bridge', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    return restartBridge();
  });

  ipcMain.handle('dsbot-control:open-logs', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    const error = await shell.openPath(runtimePaths().runtimeLogRoot);
    return error ? { ok: false, message: error } : { ok: true, message: '已打开运行日志目录' };
  });

  ipcMain.handle('dsbot-control:about', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'DSBot 桌面端',
      message: 'DSBot 桌面端',
      detail: 'Electron 桌面启动器；SnowLuma 页面由本机已安装的 SnowLuma 服务提供。'
    });
    return { ok: true, message: '关于信息已显示' };
  });

  ipcMain.handle('dsbot-control:open-license', async (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    const error = await shell.openPath(path.join(runtimePaths().snowlumaRoot, 'EULA.md'));
    return error ? { ok: false, message: error } : { ok: true, message: '已打开 SnowLuma 许可说明' };
  });

  ipcMain.handle('dsbot-control:quit', (event) => {
    if (!canAccessSnowLuma(event)) throw new Error('未授权的 SnowLuma 控制面板');
    app.quit();
    return { ok: true };
  });

  ipcMain.handle('role-cards:load', (event) => {
    if (!canAccessRoleUi(event)) throw new Error('未授权的角色卡页面');
    return loadRoleManagerData();
  });

  ipcMain.handle('role-cards:save', (event, input) => {
    if (!canAccessRoleUi(event)) throw new Error('未授权的角色卡页面');
    return saveRoleCard(input);
  });

  ipcMain.handle('role-cards:switch', (event, input) => {
    if (!canAccessRoleUi(event)) throw new Error('未授权的角色卡页面');
    return switchSessionRole(input);
  });
}

async function restartBridgeFromMenu() {
  try {
    await restartBridge();
    dialog.showMessageBox(mainWindow, { type: 'info', title: 'QQ Bridge', message: '已发送重启请求', detail: 'QQ Bridge 将在几秒内重新启动。' });
  } catch (error) {
    dialog.showErrorBox('QQ Bridge 重启失败', error.message);
  }
}

function stopManagedServices() {
  if (process.platform !== 'win32') {
    for (const child of serviceChildren.values()) child.kill('SIGTERM');
    serviceChildren.clear();
    return;
  }
  for (const child of serviceChildren.values()) {
    if (!child.pid) continue;
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  serviceChildren.clear();
}

if (hasSingleInstance) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createMainWindow();
    createMenu();
    registerIpc();
    installSnowLumaCredentialHooks();
    startServiceMonitor();
    await startAllServices();
  }).catch((error) => {
    dialog.showErrorBox('DSBot 启动失败', error.message);
  });

  app.on('before-quit', () => {
    quitting = true;
    if (serviceMonitorTimer) clearInterval(serviceMonitorTimer);
    serviceMonitorTimer = null;
  });
  app.on('activate', () => {
    if (!mainWindow) {
      createMainWindow();
      startServiceMonitor();
      startAllServices();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
