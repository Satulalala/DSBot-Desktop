// DSH 的 tool/result 可能 isError=false，但把未准入的图像替换为诊断文字。
// 只统计交付结果，绝不把原始图像/base64 写入日志。
export function inspectImageDelivery(content) {
  let imageCount = 0;
  const failures = [];
  const texts = [];
  function visit(blocks) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (block?.type === 'image') imageCount += 1;
      else if (block?.type === 'tool-result') visit(block.content);
      else if (block?.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
        for (const match of block.text.matchAll(/\[image unavailable:[^\r\n]*?\]/g)) failures.push(match[0]);
      }
    }
  }
  visit(content);
  return { imageCount, failures, text: texts.join('\n') };
}
