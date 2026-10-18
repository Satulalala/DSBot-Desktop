// 真正验证模型收到了图像：独立 minimal 会话读取随机数字图片，不接入 QQ 会话或发送工具。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { NodeApiClient, unwrap, createTurnCollector } from '../src/dsh-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

function digitImage(digits) {
  const glyphs = ['111/101/101/101/111', '010/110/010/010/111', '111/001/111/100/111', '111/001/111/001/111', '101/101/111/001/001', '111/100/111/001/111', '111/100/111/101/111', '111/001/010/010/010', '111/101/111/101/111', '111/101/111/001/111'];
  const scale = 18;
  const width = digits.length * 4 * scale + scale;
  const height = 7 * scale;
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y += 1) pixels[y * stride] = 0;
  [...digits].forEach((digit, i) => {
    glyphs[Number(digit)].split('/').forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        for (let py = 0; py < scale; py += 1) {
          for (let px = 0; px < scale; px += 1) {
            const offset = ((y + 1) * scale + py) * stride + 1 + ((i * 4 + x + 1) * scale + px) * 3;
            pixels.fill(0, offset, offset + 3);
          }
        }
      });
    });
  });
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const api = new NodeApiClient(config.dsh?.baseUrl);
const cwd = path.join(ROOT, 'state', 'vision-self-test');
fs.mkdirSync(cwd, { recursive: true });
const { sessionId } = unwrap(await api.sessions.create({ cwd, agentPreset: 'minimal' }), 'session.create');
console.log(`独立识图自检会话：${sessionId}（minimal，无 QQ 发送工具）`);
let succeeded = false;
const controller = new AbortController();
let timer;
let pump;
try {
  unwrap(await api.sessions.selectModel({ sessionId, provider: config.dsh.provider, model: config.dsh.model, reasoningEffort: config.dsh.reasoningEffort }), 'session.selectModel');
  const expected = String(randomInt(100000, 1000000));
  const collector = createTurnCollector();
  let opened;
  const ready = new Promise((resolve) => { opened = resolve; });
  let finish;
  let fail;
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // 同时观察连接和回合超时，确保失败不会遗留测试回合。
  done.catch(() => {});
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('识图自检超过 180 秒')), 180000);
  });
  pump = (async () => {
    for await (const envelope of api.events.mux({}, controller.signal, opened)) {
      const frame = envelope.payload;
      if (frame.type !== 'session/event' || frame.sessionId !== sessionId) continue;
      if (frame.event.type === 'tool/call') throw new Error('自检模型试图调用工具，已中止；本项只允许看图回答');
      const ended = collector.push(frame.event);
      if (ended) { finish(ended); return; }
    }
  })().catch(fail);
  await Promise.race([ready, done, deadline]);
  unwrap(await api.sessions.prompt({
    sessionId,
    mode: 'queue',
    content: [
      { type: 'text', text: '识别所附图片中的六位数字，只回答六位数字，不要解释，不要调用任何工具。' },
      { type: 'image', mediaType: 'image/png', data: digitImage(expected).toString('base64') }
    ]
  }), 'session.prompt');
  const result = await Promise.race([done, deadline]);
  const actual = result.text.trim();
  if (result.reason.kind !== 'completed' || actual !== expected) {
    throw new Error(`模型未通过随机图像识别：预期 ${expected}，返回 ${JSON.stringify(actual)}，结束原因 ${result.reason.kind}`);
  }
  succeeded = true;
  console.log(`通过：图片内随机数字 ${expected}，模型返回 ${actual}。图片未以文字泄露给模型。`);
} finally {
  clearTimeout(timer);
  controller.abort();
  if (!succeeded) await api.sessions.cancel({ sessionId }).catch(() => {});
  await pump;
  try {
    unwrap(await api.workspace.archiveSession({ sessionId }), 'workspace.archiveSession');
  } catch (error) {
    console.error(`测试会话归档失败 ${sessionId}：${error.message}`);
  }
}
