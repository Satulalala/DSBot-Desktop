#!/usr/bin/env node
// setup-dsh.mjs — 在目标设备上安装 qq-bridge 的 DSH 端配置
//
// 功能：
//   1. 安装两套 agent preset：qq-chat、qq-chat-v2
//   2. 在 DSH profile 的 cordis.patch.yml 中挂载三个 MCP server：
//      mcp-snowluma / mcp-snowluma-host / mcp-web-search-safe
//   3. 在 profile package.json 中注册 qq-mode-console 插件
//
// 用法：
//   node scripts/setup-dsh.mjs [profile]
//
// 默认 profile 为 web；可用环境变量 DSH_HOME 指定 DSH 根目录。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DATA_ROOT = process.env.DSBOT_DATA_DIR || REPO_ROOT;
const PROFILE = process.argv[2] || 'web';

function log(msg) {
  console.log(`[setup-dsh] ${msg}`);
}

function fatal(msg) {
  console.error(`[setup-dsh] ERROR: ${msg}`);
  process.exit(1);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(source);
    const targetIsDirectory = fs.statSync(source).isDirectory();
    const type = process.platform === 'win32'
      ? (targetIsDirectory ? 'junction' : 'file')
      : (targetIsDirectory ? 'dir' : 'file');
    fs.symlinkSync(target, destination, type);
    return;
  }
  if (!stat.isDirectory()) {
    ensureDir(path.dirname(destination));
    fs.copyFileSync(source, destination);
    return;
  }
  ensureDir(destination);
  for (const name of fs.readdirSync(source)) {
    copyTree(path.join(source, name), path.join(destination, name));
  }
}

function copyPreset(name) {
  const src = path.join(REPO_ROOT, 'dsh', 'agent-presets', name);
  const dest = path.join(DSH_HOME, '.agent-presets', name);
  if (!fs.existsSync(src)) fatal(`preset source not found: ${src}`);
  if (fs.existsSync(dest)) {
    log(`preset already exists; leaving user copy unchanged: ${name}`);
    return;
  }
  ensureDir(path.dirname(dest));
  copyTree(src, dest);
  log(`preset installed: ${name}`);
}

function yamlSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function mcpBlock() {
  const node = process.execPath;
  const servers = {
    'mcp-snowluma': path.join(REPO_ROOT, 'src', 'mcp-snowluma-safe.js'),
    'mcp-snowluma-host': path.join(REPO_ROOT, 'src', 'mcp-host-server.js'),
    'mcp-web-search-safe': path.join(REPO_ROOT, 'src', 'mcp-web-search-safe.js'),
  };
  let out = '# === qq-bridge MCP BEGIN ===\n';
  for (const [id, script] of Object.entries(servers)) {
    out += `- insert:\n`;
    out += `    - id: ${id}\n`;
    out += `      name: '@deepseek-ai/dsh-mcp-client'\n`;
    out += `      config:\n`;
    out += `        serverName: ${id.replace('mcp-', '')}\n`;
    out += `        transport: stdio\n`;
    out += `        command: ${yamlSingleQuote(node)}\n`;
    out += `        args:\n`;
    out += `          - ${yamlSingleQuote(script)}\n`;
    if (id === 'mcp-snowluma') {
      out += `        toolCallTimeoutMs: 725000\n`;
    }
  }
  out += '# === qq-bridge MCP END ===\n';
  return out;
}

function patchCordis() {
  const profileDir = path.join(DSH_HOME, 'profiles', PROFILE);
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  ensureDir(profileDir);
  let text = '';
  if (fs.existsSync(patchFile)) {
    text = fs.readFileSync(patchFile, 'utf8');
  }
  const beginMarker = '# === qq-bridge MCP BEGIN ===';
  const endMarker = '# === qq-bridge MCP END ===';
  const block = mcpBlock();
  if (text.includes(beginMarker) && text.includes(endMarker)) {
    text = text.replace(
      /[^\n]*# === qq-bridge MCP BEGIN ===[\s\S]*?# === qq-bridge MCP END ===[^\n]*/,
      block.trimEnd(),
    );
    log(`cordis.patch.yml: qq-bridge MCP block updated`);
  } else if (text.includes('id: mcp-snowluma') || text.includes('mcp-snowluma-safe.js')) {
    log(`cordis.patch.yml already contains mcp-snowluma entries; skipped auto-insert. Please check manually if they point to this repo.`);
    return;
  } else {
    // 剥离 DSH 模板自带、独立成行的空数组 `[]`，否则追加的 block 列表会与它组成
    // 两个 YAML 根节点，DSH 启动时报 “end of the stream or a document separator is expected”。
    text = text.replace(/^[ \t]*\[\][ \t]*(?:\r?\n|$)/gm, '');
    if (text.trim().length > 0) {
      if (!text.endsWith('\n')) text += '\n';
      text += `\n${block}`;
    } else {
      text += block;
    }
    log(`cordis.patch.yml: qq-bridge MCP block appended`);
  }
  fs.writeFileSync(patchFile, text, 'utf8');
}

function ensureProfileBundleCopy(pluginSource) {
  const moduleRoot = path.join(DSH_HOME, 'node_modules');
  const bundleDir = path.join(moduleRoot, 'qq-mode-console');
  if (!fs.existsSync(pluginSource)) fatal(`plugin not found: ${pluginSource}`);
  ensureDir(bundleDir);
  for (const name of fs.readdirSync(pluginSource)) {
    copyTree(path.join(pluginSource, name), path.join(bundleDir, name));
  }
  log(`profile bundle copied: ${bundleDir}`);
}

function patchProfilePackage(pluginSource) {
  const profileDir = path.join(DSH_HOME, 'profiles', PROFILE);
  const pkgFile = path.join(profileDir, 'package.json');
  ensureDir(profileDir);
  let pkg = { name: `dsh-profile-${PROFILE}`, private: true, dependencies: {}, dsh: { profile: { bundles: [] } } };
  if (fs.existsSync(pkgFile)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    } catch (e) {
      fatal(`failed to parse ${pkgFile}: ${e.message}`);
    }
  }
  pkg.name = pkg.name || `dsh-profile-${PROFILE}`;
  pkg.private = pkg.private !== false;
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies)) pkg.dependencies = {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = [];
  const defaultBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  for (const [index, bundle] of defaultBundles.entries()) {
    const existingIndex = pkg.dsh.profile.bundles.indexOf(bundle);
    if (existingIndex === index) continue;
    if (existingIndex >= 0) pkg.dsh.profile.bundles.splice(existingIndex, 1);
    pkg.dsh.profile.bundles.splice(index, 0, bundle);
    log(`package.json default bundle ensured: ${bundle}`);
  }
  const linkVal = `link:${pluginSource.replace(/\\/g, '/')}`;
  if (pkg.dependencies['qq-mode-console'] !== linkVal) {
    pkg.dependencies['qq-mode-console'] = linkVal;
    log(`package.json dependency qq-mode-console -> ${linkVal}`);
  }
  if (!pkg.dsh.profile.bundles.includes('qq-mode-console')) {
    pkg.dsh.profile.bundles.push('qq-mode-console');
    log(`package.json bundle added: qq-mode-console`);
  }
  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  log(`profile package.json ensured: ${pkgFile}`);
}

function ensureLocalModeFile() {
  const stateDir = path.join(DATA_ROOT, 'state');
  const modeFile = path.join(stateDir, 'mode.json');
  if (fs.existsSync(modeFile)) {
    log(`state/mode.json already exists; leave as-is (current mode may be user-configured)`);
    return;
  }
  ensureDir(stateDir);
  fs.writeFileSync(modeFile, `${JSON.stringify({ mode: 'reserved2', closedAgentPreset: 'router-standard' }, null, 2)}\n`, 'utf8');
  log(`state/mode.json created with mode=reserved2 (fallback if DSH settings are not available)`);
}

copyPreset('qq-chat');
copyPreset('qq-chat-v2');
patchCordis();
const pluginSource = path.join(REPO_ROOT, 'plugins', 'qq-mode-console');
patchProfilePackage(pluginSource);
ensureProfileBundleCopy(pluginSource);
ensureLocalModeFile();
log('Done. DSH runtime is configured without a network package-install step.');
