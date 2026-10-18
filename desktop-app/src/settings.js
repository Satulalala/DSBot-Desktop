const result = document.getElementById('result');
const saveButton = document.getElementById('save');
const restartButton = document.getElementById('restart');

const numericFields = [
  'autoReplyCheckMs', 'preSleepWaitMs', 'maxWakePerMinute', 'maxWakePerHour',
  'burstIntervalMinMs', 'burstIntervalMaxMs', 'maxSendPerMinute', 'maxMessageChars',
  'proactiveIdleThresholdMs', 'recentLimit', 'unreadLimit', 'contextWindow'
];
const booleanFields = ['socialEnabled', 'preSleepWaitEnabled', 'burstEnabled', 'proactiveEnabled'];

function setValue(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.type === 'checkbox') element.checked = value === true;
  else element.value = value ?? '';
}

function readForm() {
  const settings = {
    model: document.getElementById('model').value.trim(),
    reasoningEffort: document.getElementById('reasoningEffort').value,
    wakeDefaultMode: document.getElementById('wakeDefaultMode').value,
    wakeProbability: Number(document.getElementById('wakeProbability').value),
    proactiveProbability: Number(document.getElementById('proactiveProbability').value)
  };
  for (const key of booleanFields) settings[key] = document.getElementById(key).checked;
  for (const key of numericFields) settings[key] = Number(document.getElementById(key).value);
  return settings;
}

function showProbability(id) {
  document.getElementById(`${id}Value`).value = `${Math.round(Number(document.getElementById(id).value) * 100)}%`;
}

async function loadSettings() {
  try {
    const settings = await window.dsbotSettings.load();
    for (const [key, value] of Object.entries(settings)) setValue(key, value);
    showProbability('wakeProbability');
    showProbability('proactiveProbability');
    result.textContent = '已读取本机配置';
  } catch (error) {
    result.textContent = `读取配置失败：${error.message}`;
    saveButton.disabled = true;
  }
}

async function saveAndApply() {
  saveButton.disabled = true;
  restartButton.disabled = true;
  result.textContent = '正在保存参数…';
  try {
    const response = await window.dsbotSettings.saveAndApply(readForm());
    result.textContent = response.restart?.message || '参数已保存';
    if (response.restart?.ok) result.textContent += ' 配置将在 QQ Bridge 重启后生效。';
  } catch (error) {
    result.textContent = `保存失败：${error.message}`;
  } finally {
    saveButton.disabled = false;
    restartButton.disabled = false;
  }
}

async function restartBridge() {
  restartButton.disabled = true;
  result.textContent = '正在请求重启…';
  try {
    const response = await window.dsbotSettings.restartBridge();
    result.textContent = response.message || 'QQ Bridge 正在重启';
  } catch (error) {
    result.textContent = `重启失败：${error.message}`;
  } finally {
    restartButton.disabled = false;
  }
}

document.getElementById('wakeProbability').addEventListener('input', () => showProbability('wakeProbability'));
document.getElementById('proactiveProbability').addEventListener('input', () => showProbability('proactiveProbability'));
saveButton.addEventListener('click', saveAndApply);
restartButton.addEventListener('click', restartBridge);
loadSettings();
