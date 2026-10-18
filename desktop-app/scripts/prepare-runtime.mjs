import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const RUNTIME_ROOT = path.join(APP_ROOT, 'runtime');
const CACHE_ROOT = path.join(RUNTIME_ROOT, 'cache');
const BUNDLE_ROOT = path.join(RUNTIME_ROOT, 'bundle');
const NODE_VERSION = 'v22.23.3';
const NODE_ARCHIVE = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_DIST_URL = `https://nodejs.org/dist/${NODE_VERSION}`;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 退出，代码 ${result.status ?? '未知'}`);
}

async function download(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) return;
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`下载失败（${response.status}）：${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`缺少运行文件：${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`缺少运行文件：${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function prepareNodeRuntime() {
  const archivePath = path.join(CACHE_ROOT, NODE_ARCHIVE);
  const sumsPath = path.join(CACHE_ROOT, `${NODE_VERSION}-SHASUMS256.txt`);
  const extractedRoot = path.join(CACHE_ROOT, `node-${NODE_VERSION}-win-x64`);

  return Promise.all([
    download(`${NODE_DIST_URL}/${NODE_ARCHIVE}`, archivePath),
    download(`${NODE_DIST_URL}/SHASUMS256.txt`, sumsPath)
  ]).then(() => {
    const sums = fs.readFileSync(sumsPath, 'utf8');
    const entry = sums.split(/\r?\n/).find((line) => line.endsWith(`  ${NODE_ARCHIVE}`));
    if (!entry) throw new Error(`Node.js 校验文件中没有 ${NODE_ARCHIVE}`);
    const expected = entry.split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (actual !== expected) throw new Error('Node.js 压缩包 SHA-256 校验失败');

    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    run('tar.exe', ['-xf', archivePath, '-C', CACHE_ROOT]);
    copyFile(path.join(extractedRoot, 'node.exe'), path.join(BUNDLE_ROOT, 'node', 'node.exe'));
    copyFile(path.join(extractedRoot, 'LICENSE'), path.join(BUNDLE_ROOT, 'node', 'LICENSE'));
  });
}

function npmCliArgs(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('请使用 npm run make 或 npm run package 准备运行时依赖。');
  return [npmCli, ...args];
}

async function installDependencies(directory) {
  run(process.execPath, npmCliArgs(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']), directory);
}

async function prepareDshRuntime() {
  const destination = path.join(BUNDLE_ROOT, 'dsh');
  const dshDirectory = path.join(destination, 'node_modules', '@deepseek-ai', 'dsh');
  const globalDsh = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh');
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(globalDsh, 'package.json'), 'utf8')).version; } catch {}

  if (version === '0.1.1-rc.2') {
    copyDirectory(globalDsh, dshDirectory);
  } else {
    fs.mkdirSync(destination, { recursive: true });
    copyFile(path.join(APP_ROOT, 'runtime-manifests', 'dsh', 'package.json'), path.join(destination, 'package.json'));
    run(process.execPath, npmCliArgs(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']), destination);
  }
  copyFile(path.join(dshDirectory, 'LICENSE'), path.join(BUNDLE_ROOT, 'NOTICE.txt'));
}

async function prepareBridgeRuntime() {
  const destination = path.join(BUNDLE_ROOT, 'qq-bridge');
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of ['src', 'public', 'roles', 'plugins/qq-mode-console', 'dsh/agent-presets']) {
    copyDirectory(path.join(REPO_ROOT, entry), path.join(destination, entry));
  }
  copyFile(path.join(REPO_ROOT, 'assets', 'deepseek娘.png'), path.join(destination, 'assets', 'deepseek娘.png'));
  for (const entry of ['package.json', 'package-lock.json', 'config.example.json']) {
    copyFile(path.join(REPO_ROOT, entry), path.join(destination, entry));
  }
  copyFile(path.join(REPO_ROOT, 'scripts', 'setup-dsh.mjs'), path.join(destination, 'scripts', 'setup-dsh.mjs'));

  const packageFile = path.join(destination, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  manifest.scripts = { start: 'node src/bridge.js' };
  fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await installDependencies(destination);

  const nodeLicense = fs.readFileSync(path.join(BUNDLE_ROOT, 'node', 'LICENSE'), 'utf8');
  const dshLicense = fs.readFileSync(path.join(BUNDLE_ROOT, 'NOTICE.txt'), 'utf8');
  const qqBridgeLicense = path.join(APP_ROOT, 'licenses', 'qq-bridge-LICENSE.txt');
  const snowlumaLicense = path.join(APP_ROOT, 'licenses', 'snowluma-LICENSE.txt');
  copyFile(qqBridgeLicense, path.join(BUNDLE_ROOT, 'licenses', 'qq-bridge-LICENSE.txt'));
  copyFile(snowlumaLicense, path.join(BUNDLE_ROOT, 'licenses', 'snowluma-LICENSE.txt'));
  const notices = [
    'Third-party notices for the bundled desktop runtime.',
    'QQ Bridge: see licenses/qq-bridge-LICENSE.txt.',
    'SnowLuma and its SDK/MCP packages: see licenses/snowluma-LICENSE.txt.',
    'DeepSeek Harness license follows:',
    dshLicense,
    `Node.js ${NODE_VERSION} license follows:`,
    nodeLicense
  ];
  fs.writeFileSync(path.join(BUNDLE_ROOT, 'NOTICE.txt'), `${notices.join('\n\n')}\n`, 'utf8');
}

function archiveRuntimeBundle() {
  const archivePath = path.join(BUNDLE_ROOT, 'DSBot-runtime.zip');
  run('tar.exe', [
    '-a', '-c', '-f', archivePath,
    '-C', BUNDLE_ROOT,
    'node', 'dsh', 'qq-bridge', 'licenses', 'NOTICE.txt'
  ], BUNDLE_ROOT);
  if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size === 0) {
    throw new Error('桌面端运行时压缩包生成失败');
  }
}

if (process.platform !== 'win32') {
  throw new Error('Windows 安装包的运行时资源只能在 Windows 构建环境中准备。');
}

fs.rmSync(BUNDLE_ROOT, { recursive: true, force: true });
fs.mkdirSync(BUNDLE_ROOT, { recursive: true });
await prepareNodeRuntime();
await prepareDshRuntime();
await prepareBridgeRuntime();
archiveRuntimeBundle();
console.log(`运行时资源已准备：${BUNDLE_ROOT}`);
