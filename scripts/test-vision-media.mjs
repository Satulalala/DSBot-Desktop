// 视觉/图片链路自检脚本：
// 1. 校验模型名已被当前 DSH 模型目录识别
// 2. 校验 safe-fetch 的 SSRF 防护（本机地址应被拒绝）
// 3. 下载一条真实图片消息，并确认图片数据返回给 MCP
// 运行：node scripts/test-vision-media.mjs [group:群号|private:QQ号] [messageId]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetchBuffer } from '../src/safe-fetch.js';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';
import { inspectImageDelivery } from '../src/vision-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

const config = readJson(path.join(ROOT, 'config.json'));
let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.error(`❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

// 1. 配置和 DSH 实际模型目录
const visionModelAliases = new Set(['deepseek-v4-flash-vision-exp']);
check(
  'config.dsh.model 使用明确声明图像输入的视觉模型',
  config.dsh?.provider === 'deepseek-official' && visionModelAliases.has(config.dsh?.model),
  `当前 ${config.dsh?.provider}/${config.dsh?.model}`
);
check('config.dsh.reasoningEffort 为 max', config.dsh?.reasoningEffort === 'max', `当前 ${config.dsh?.reasoningEffort}`);
check('config.socialV2.tools.getImages 默认开启', config.socialV2?.tools?.getImages !== false);
const refusedImage = inspectImageDelivery([{ type: 'tool-result', isError: false, content: [
  { type: 'text', text: '[image unavailable: image/png; model "deepseek-flash" does not declare image input; raw image data remains available to programmatic callers]' }
] }]);
check('MCP 成功但图像被模型拒绝时能识别真实失败', refusedImage.failures.length === 1 && refusedImage.imageCount === 0);
const acceptedImage = inspectImageDelivery([{ type: 'tool-result', content: [
  { type: 'image', attachment: { attachmentId: 'test-image' } }
] }]);
check('能统计 DSH 实际交付给模型的图像块', acceptedImage.imageCount === 1 && acceptedImage.failures.length === 0);
try {
  const api = new NodeApiClient(config.dsh?.baseUrl);
  const catalog = unwrap(await api.llm.models({}), 'llm.models');
  const provider = String(config.dsh?.provider || 'deepseek-official');
  const model = String(config.dsh?.model || '');
  const group = catalog.groups?.find((item) => item.id === provider);
  const listed = group?.models?.some((item) => item.id === model) === true;
  check('当前 DSH 模型目录包含配置的模型', listed, `${provider}/${model}`);
} catch (error) {
  check('当前 DSH 模型目录可读取', false, error?.message ?? error);
}

// 2. safe-fetch SSRF
try {
  await safeFetchBuffer('http://127.0.0.1/');
  check('safe-fetch 拒绝本机地址', false, '未抛出异常');
} catch (error) {
  check('safe-fetch 拒绝本机地址', /内网|本机|禁止/.test(String(error?.message ?? error)), error?.message);
}

// 3. 用最近一条真实图片消息验证桥接取图。支持显式传入：node scripts/test-vision-media.mjs group:群号 messageId
const consoleTokenFile = path.join(ROOT, 'state', 'console-token');
const socialV2File = path.join(ROOT, 'state', 'social-v2.json');
const [keyArg, messageIdArg] = process.argv.slice(2);
if (!fs.existsSync(consoleTokenFile) || !fs.existsSync(socialV2File)) {
  check('存在可用图片消息样本', false, '缺少 state/console-token 或 state/social-v2.json');
} else {
  try {
    const consoleToken = fs.readFileSync(consoleTokenFile, 'utf8').trim();
    const social = JSON.parse(fs.readFileSync(socialV2File, 'utf8'));
    const candidates = Object.entries(social?.conversations ?? {}).flatMap(([key, st]) =>
      [...(Array.isArray(st?.recentMessages) ? st.recentMessages : [])]
        .reverse()
        .filter((message) => message?.hasMedia && message?.messageId != null)
        .map((message) => ({ key, messageId: message.messageId }))
    );
    const sample = keyArg && messageIdArg
      ? { key: keyArg, messageId: messageIdArg }
      : candidates[0];
    if (!sample) {
      check('存在可用图片消息样本', false, '先让机器人收到一张图片，或传入 key 和 messageId');
    } else {
      check('存在可用图片消息样本', true, `${sample.key} / ${sample.messageId}`);
      const { key, messageId } = sample;
      const conv = social?.conversations?.[key];
      const agentToken = conv?.agentToken;
      if (!agentToken) throw new Error(`会话 ${key} 没有 agentToken`);
      const url = `http://127.0.0.1:${config.consolePort || 3100}/api/images/message?key=${encodeURIComponent(key)}&messageId=${encodeURIComponent(String(messageId))}`;
      const res = await fetch(url, { headers: { 'x-agent-token': agentToken, 'x-console-token': consoleToken }, signal: AbortSignal.timeout(10000) });
      const body = await res.json().catch(() => ({}));
      check('桥接 /api/images/message 端点可访问', res.ok === true && body.ok === true, `HTTP ${res.status}${body.error ? ` — ${body.error}` : ''}`);
      const images = Array.isArray(body.images) ? body.images : [];
      const validImages = images.length > 0 && images.every((image) => image?.data && image?.mimeType);
      check('真实图片已下载并返回给 MCP', res.ok === true && body.ok === true && validImages, `图片数 ${images.length}`);
    }
  } catch (error) {
    const detail = error?.cause?.code === 'ECONNREFUSED'
      ? `端口 ${config.consolePort || 3100} 未监听；先启动桥接`
      : (error?.message ?? error);
    check('桥接取图端点完成真实图片检查', false, detail);
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
console.log('以上覆盖取图与投影诊断；真实模型识图请运行 node scripts/test-vision-e2e.mjs。');
process.exit(failed > 0 ? 1 : 0);
