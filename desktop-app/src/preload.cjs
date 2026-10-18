const { contextBridge, ipcRenderer } = require('electron');

const currentUrl = window.location.href;

if (currentUrl.startsWith('file:') && currentUrl.endsWith('/splash.html')) {
  contextBridge.exposeInMainWorld('dsbotStartup', Object.freeze({
    onUpdate(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('startup:update', handler);
      return () => ipcRenderer.removeListener('startup:update', handler);
    },
    openSettings: () => ipcRenderer.send('startup:open-settings'),
    selectSnowLumaDirectory: () => ipcRenderer.invoke('startup:select-snowluma-directory'),
    retry: () => ipcRenderer.invoke('startup:retry'),
    startService: (name) => ipcRenderer.invoke('startup:start-service', name)
  }));
} else if (currentUrl.startsWith('file:') && currentUrl.endsWith('/settings.html')) {
  contextBridge.exposeInMainWorld('dsbotSettings', Object.freeze({
    load: () => ipcRenderer.invoke('settings:load'),
    saveAndApply: (settings) => ipcRenderer.invoke('settings:save-and-apply', settings),
    restartBridge: () => ipcRenderer.invoke('settings:restart-bridge')
  }));
} else if (window.location.origin === 'http://127.0.0.1:5099') {
  let savedPassword = '';
  let remembered = false;
  let observer;

  const controlApi = Object.freeze({
    onUpdate(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('dsbot-control:service-update', handler);
      return () => ipcRenderer.removeListener('dsbot-control:service-update', handler);
    },
    getServices: () => ipcRenderer.invoke('dsbot-control:get-services'),
    refreshServices: () => ipcRenderer.invoke('dsbot-control:refresh-services'),
    startService: (name) => ipcRenderer.invoke('dsbot-control:start-service', name),
    startAll: () => ipcRenderer.invoke('dsbot-control:start-all'),
    openSettings: () => ipcRenderer.invoke('dsbot-control:open-settings'),
    reloadSnowLuma: () => ipcRenderer.invoke('dsbot-control:reload-snowluma'),
    restartBridge: () => ipcRenderer.invoke('dsbot-control:restart-bridge'),
    openLogs: () => ipcRenderer.invoke('dsbot-control:open-logs'),
    showAbout: () => ipcRenderer.invoke('dsbot-control:about'),
    openLicense: () => ipcRenderer.invoke('dsbot-control:open-license'),
    quit: () => ipcRenderer.invoke('dsbot-control:quit')
  });
  contextBridge.exposeInMainWorld('dsbotControl', controlApi);

  function fillPassword(input) {
    if (!savedPassword || !input || input.value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, savedPassword);
    else input.value = savedPassword;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mountRememberOption() {
    const input = document.querySelector('input[name="password"]');
    const form = input?.closest('form');
    if (!form) return;
    let option = form.querySelector('[data-dsbot-remember]');
    if (!option) {
      option = document.createElement('label');
      option.dataset.dsbotRemember = 'true';
      option.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 0;color:#687d84;font:12px/1.4 Segoe UI,Microsoft YaHei UI,sans-serif;cursor:pointer;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = remembered;
      checkbox.style.accentColor = '#079cc4';
      checkbox.addEventListener('change', () => {
        remembered = checkbox.checked;
        ipcRenderer.send('credential:remember-option', remembered);
      });
      const text = document.createElement('span');
      text.textContent = '记住访问密码（使用 Windows 加密保存）';
      option.append(checkbox, text);
      form.insertBefore(option, form.lastElementChild);
      ipcRenderer.send('credential:remember-option', remembered);
    }
    fillPassword(input);
  }

  function installControlPanel() {
    if (!document.body || document.getElementById('dsbot-control-panel-root')) return;

    const host = document.createElement('div');
    host.id = 'dsbot-control-panel-root';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; color: #17364b; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
        * { box-sizing: border-box; }
        button { font: inherit; }
        #launcher { position: fixed; z-index: 2147483000; right: 20px; bottom: 20px; display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 0 15px; border: 1px solid #cfe3ec; border-radius: 22px; background: #fff; color: #17364b; box-shadow: 0 4px 18px #163a4b20; font-size: 13px; font-weight: 650; cursor: pointer; }
        #launcher:hover { border-color: #08a5d4; box-shadow: 0 5px 20px #163a4b2b; }
        #lamp { width: 9px; height: 9px; border-radius: 50%; background: #95a5ad; }
        #lamp[data-state="online"] { background: #16a878; }
        #lamp[data-state="warning"] { background: #e3a22e; }
        #lamp[data-state="error"] { background: #d65f55; }
        #panel { position: fixed; z-index: 2147483000; right: 20px; bottom: 72px; width: min(380px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 112px)); overflow: auto; border: 1px solid #d7e5eb; border-radius: 16px; background: #fff; box-shadow: 0 12px 38px #17364b29; color: #17364b; }
        #panel[hidden] { display: none !important; }
        header { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 13px; border-bottom: 1px solid #e8eff2; background: #fff; }
        header strong { display: block; font-size: 16px; }
        header small { display: block; margin-top: 4px; color: #687f8b; font-size: 11px; }
        .icon-button { width: 32px; height: 32px; border: 0; border-radius: 9px; background: #f2f7f9; color: #536b77; font-size: 18px; cursor: pointer; }
        .toolbar { display: flex; gap: 8px; padding: 12px 16px 6px; }
        .toolbar button, .service-action, .actions button { min-height: 34px; padding: 0 11px; border: 1px solid #d6e5eb; border-radius: 9px; background: #fff; color: #17637b; font-size: 12px; cursor: pointer; }
        .toolbar button.primary { flex: 1; border-color: #079cc4; background: #079cc4; color: #fff; }
        button:disabled { cursor: wait; opacity: .55; }
        #services { display: grid; gap: 8px; padding: 8px 16px; }
        .service { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding: 11px 12px; border: 1px solid #e0eaee; border-radius: 11px; }
        .service-name { min-width: 0; font-size: 13px; font-weight: 650; }
        .service-port { margin-top: 3px; color: #78909a; font-size: 11px; }
        .service-state { align-self: start; padding: 4px 8px; border-radius: 7px; background: #eff3f5; color: #647680; font-size: 11px; white-space: nowrap; }
        .service-state[data-state="online"] { background: #e7f7f1; color: #129366; }
        .service-state[data-state="error"] { background: #fff0ed; color: #c45146; }
        .service-detail { grid-column: 1 / -1; color: #657c87; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
        .service-action { grid-column: 1 / -1; justify-self: start; min-height: 30px; margin-top: 3px; }
        .service-action[hidden] { display: none; }
        #notice { min-height: 18px; margin: 2px 17px 12px; color: #617783; font-size: 11px; line-height: 1.45; }
        details { margin: 0 16px 14px; border-top: 1px solid #e8eff2; }
        summary { padding: 12px 2px 8px; color: #536d78; font-size: 12px; cursor: pointer; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .actions button { text-align: left; color: #3f5966; }
        .actions button.danger { color: #b64f48; }
        @media (max-width: 520px) { #launcher { right: 12px; bottom: 12px; } #panel { right: 12px; bottom: 64px; width: calc(100vw - 24px); } }
      </style>
      <button id="launcher" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span id="lamp" aria-hidden="true"></span><span>DSBot 本机服务</span>
      </button>
      <section id="panel" role="dialog" aria-label="DSBot 本机服务控制" hidden>
        <header><div><strong>DSBot 本机服务</strong><small id="monitor">正在连接监控…</small></div><button class="icon-button" id="close" type="button" aria-label="关闭">×</button></header>
        <div class="toolbar"><button id="refresh" type="button">立即检查</button><button class="primary" id="start-all" type="button">检查并启动缺失服务</button></div>
        <div id="services"></div>
        <p id="notice" role="status" aria-live="polite">正在读取服务状态…</p>
        <details><summary>其他桌面功能</summary><div class="actions">
          <button type="button" data-action="settings">机器人参数…</button>
          <button type="button" data-action="restart-bridge">重启 QQ Bridge</button>
          <button type="button" data-action="reload">重新加载 SnowLuma</button>
          <button type="button" data-action="logs">打开运行日志目录</button>
          <button type="button" data-action="about">关于 DSBot 桌面端</button>
          <button type="button" data-action="license">SnowLuma 许可说明</button>
          <button class="danger" type="button" data-action="quit">退出桌面端</button>
        </div></details>
      </section>`;
    document.body.append(host);

    const panel = root.getElementById('panel');
    const launcher = root.getElementById('launcher');
    const lamp = root.getElementById('lamp');
    const monitor = root.getElementById('monitor');
    const notice = root.getElementById('notice');
    const rows = new Map();
    const labels = { dsh: 'DeepSeek Harness', snowluma: 'SnowLuma', bridge: 'QQ Bridge' };
    const statusLabels = { online: '运行中', error: '未运行', starting: '启动中', checking: '检测中' };

    for (const name of ['dsh', 'snowluma', 'bridge']) {
      const card = document.createElement('article');
      card.className = 'service';
      const identity = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'service-name';
      title.textContent = labels[name];
      const port = document.createElement('div');
      port.className = 'service-port';
      identity.append(title, port);
      const status = document.createElement('span');
      status.className = 'service-state';
      const detail = document.createElement('div');
      detail.className = 'service-detail';
      const action = document.createElement('button');
      action.className = 'service-action';
      action.type = 'button';
      action.addEventListener('click', () => run(action, () => controlApi.startService(name), '正在启动…'));
      card.append(identity, status, detail, action);
      root.getElementById('services').append(card);
      rows.set(name, { port, status, detail, action });
    }

    function render(state) {
      const entries = state?.services || {};
      const statuses = [];
      for (const name of ['dsh', 'snowluma', 'bridge']) {
        const service = entries[name];
        const row = rows.get(name);
        if (!service || !row) continue;
        const status = service.status || 'checking';
        statuses.push(status);
        row.port.textContent = service.port ? `127.0.0.1:${service.port}` : '';
        row.status.textContent = statusLabels[status] || status;
        row.status.dataset.state = status;
        row.detail.textContent = service.detail || '';
        row.action.textContent = service.actionLabel || '启动';
        row.action.hidden = status === 'online';
        row.action.disabled = status === 'starting' || status === 'checking';
      }
      const allOnline = statuses.length === 3 && statuses.every((status) => status === 'online');
      const hasError = statuses.some((status) => status === 'error');
      lamp.dataset.state = allOnline ? 'online' : (hasError ? 'error' : 'warning');
      monitor.textContent = state?.message || '自动检测中 · 每 5 秒检查一次';
      if (state?.message) notice.textContent = state.message;
    }

    async function run(button, action, progress) {
      if (button) button.disabled = true;
      notice.textContent = progress;
      try {
        const result = await action();
        if (result?.services) render(result);
        if (result?.message) notice.textContent = result.message;
        else if (result?.detail) notice.textContent = result.detail;
      } catch (error) {
        notice.textContent = `操作失败：${error?.message || error}`;
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    const setOpen = (open) => {
      panel.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
    };
    launcher.addEventListener('click', () => setOpen(panel.hidden));
    root.getElementById('close').addEventListener('click', () => setOpen(false));
    root.getElementById('refresh').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.refreshServices(), '正在检查服务…'));
    root.getElementById('start-all').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.startAll(), '正在启动缺失服务…'));
    root.querySelector('[data-action="settings"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.openSettings(), '正在打开机器人参数…'));
    root.querySelector('[data-action="restart-bridge"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.restartBridge(), '正在重启 QQ Bridge…'));
    root.querySelector('[data-action="reload"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.reloadSnowLuma(), '正在重新加载 SnowLuma…'));
    root.querySelector('[data-action="logs"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.openLogs(), '正在打开运行日志…'));
    root.querySelector('[data-action="about"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.showAbout(), '正在打开关于信息…'));
    root.querySelector('[data-action="license"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.openLicense(), '正在打开许可说明…'));
    root.querySelector('[data-action="quit"]').addEventListener('click', (event) => run(event.currentTarget, () => controlApi.quit(), '正在退出桌面端…'));
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) setOpen(false);
    });

    controlApi.onUpdate(render);
    controlApi.getServices().then(render).catch((error) => {
      notice.textContent = `读取服务状态失败：${error?.message || error}`;
    });
  }

  ipcRenderer.on('credential:autofill', (_event, payload) => {
    savedPassword = typeof payload?.password === 'string' ? payload.password : '';
    remembered = payload?.saved === true;
    mountRememberOption();
  });
  ipcRenderer.on('credential:save-result', (_event, result) => {
    if (!result?.ok) return;
    remembered = result.saved === true;
    const checkbox = document.querySelector('[data-dsbot-remember] input[type="checkbox"]');
    if (checkbox) checkbox.checked = remembered;
    if (!remembered) savedPassword = '';
  });

  const watchForLogin = () => mountRememberOption();
  const installObserver = () => {
    watchForLogin();
    installControlPanel();
    observer = new MutationObserver(watchForLogin);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
}
