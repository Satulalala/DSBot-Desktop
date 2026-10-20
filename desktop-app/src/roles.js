(() => {
  const sessionSelect = document.getElementById('session');
  const sessionMeta = document.getElementById('session-meta');
  const cards = document.getElementById('cards');
  const preview = document.getElementById('preview');
  const notice = document.getElementById('notice');
  const refreshButton = document.getElementById('refresh');
  const applyButton = document.getElementById('apply');
  const roleEditor = document.getElementById('role-editor');
  const editorTitle = document.getElementById('editor-title');
  const roleContentInput = document.getElementById('role-content');
  const charCount = document.getElementById('char-count');
  const saveEditButton = document.getElementById('save-edit');
  const cancelEditButton = document.getElementById('cancel-edit');
  const closeEditorButton = document.getElementById('editor-close');
  const MAX_ROLE_CHARS = 200_000;

  let roleList = [];
  let sessionList = [];
  let selectedRole = null;
  let editingRoleName = null;
  let editingOriginalContent = '';
  let editingExpectedContent = '';
  let busy = false;

  const sessionLabel = (session) => {
    const [kind, id] = session.key.split(':');
    return `${kind === 'group' ? '群聊' : '私聊'} ${id}${session.owner ? ' · 机器人主人' : ''}`;
  };

  const currentSession = () => sessionList.find((item) => item.key === sessionSelect.value) ?? null;
  const findRole = (name) => roleList.find((item) => item.name === name) ?? null;

  function renderSessions(preferredKey) {
    sessionSelect.replaceChildren();
    if (!sessionList.length) {
      const option = document.createElement('option');
      option.textContent = '当前没有已建立的 QQ 会话';
      option.value = '';
      sessionSelect.append(option);
      sessionSelect.disabled = true;
      sessionMeta.textContent = '';
      updateSelectedRole();
      return;
    }
    for (const item of sessionList) {
      const option = document.createElement('option');
      option.value = item.key;
      option.textContent = sessionLabel(item);
      sessionSelect.append(option);
    }
    sessionSelect.disabled = false;
    sessionSelect.value = sessionList.some((item) => item.key === preferredKey)
      ? preferredKey
      : sessionList[0].key;
    updateSelectedRole();
  }

  function updateSelectedRole() {
    const session = currentSession();
    selectedRole = session?.role ?? null;
    const kind = session?.key.startsWith('group:') ? '群号' : 'QQ 号';
    sessionMeta.textContent = session ? `${kind}：${session.key.split(':')[1]}` : '';
    renderRoles();
  }

  function renderRoles() {
    cards.replaceChildren();
    const choices = [{ name: null, content: '', label: '默认人格', description: '不附加角色卡设定，使用机器人的默认人格。' }, ...roleList.map((item) => ({ ...item, label: item.name }))];
    if (!sessionList.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '当前没有已建立的 QQ 会话。可以先查看角色卡；收到消息并创建会话后即可应用。';
      cards.append(empty);
    }
    for (const item of choices) {
      const card = document.createElement('article');
      card.className = 'role-card';
      card.dataset.selected = String(item.name === selectedRole);
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'role-card-select';
      selectButton.setAttribute('aria-pressed', String(item.name === selectedRole));
      const head = document.createElement('div');
      head.className = 'card-head';
      const title = document.createElement('span');
      title.className = 'role-name';
      title.textContent = item.label;
      head.append(title);
      if (item.name === currentSession()?.role) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '当前使用';
        head.append(badge);
      }
      const description = document.createElement('p');
      description.className = 'role-desc';
      const content = String(item.content || '');
      description.textContent = item.description || content.replace(/^\s*#+\s*[^\n]+\s*/, '').trim() || '此角色卡没有附加说明。';
      selectButton.append(head, description);
      selectButton.addEventListener('click', () => {
        selectedRole = item.name;
        renderRoles();
      });
      card.append(selectButton);
      if (item.name) {
        const actions = document.createElement('div');
        actions.className = 'role-card-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'role-edit';
        editButton.textContent = '编辑设定';
        editButton.setAttribute('aria-label', `编辑角色卡：${item.name}`);
        editButton.addEventListener('click', () => openEditor(item));
        actions.append(editButton);
        card.append(actions);
      }
      cards.append(card);
    }
    const selected = findRole(selectedRole);
    preview.textContent = selectedRole === null
      ? '使用默认人格，不附加额外角色设定。'
      : (selected?.content || '角色卡文件内容暂不可读。');
    applyButton.disabled = busy || !currentSession() || selectedRole === currentSession()?.role;
  }

  function setBusy(value) {
    busy = value;
    refreshButton.disabled = value;
    sessionSelect.disabled = value || !sessionList.length;
    applyButton.disabled = value || !currentSession() || selectedRole === currentSession()?.role;
    for (const button of cards.querySelectorAll('button')) button.disabled = value;
    roleContentInput.disabled = value;
    cancelEditButton.disabled = value;
    closeEditorButton.disabled = value;
    saveEditButton.disabled = value || !roleContentInput.value.trim();
  }

  function updateCharCount() {
    charCount.textContent = `${roleContentInput.value.length.toLocaleString('zh-CN')} / ${MAX_ROLE_CHARS.toLocaleString('zh-CN')}`;
    saveEditButton.disabled = busy || !roleContentInput.value.trim();
  }

  function closeEditor() {
    if (roleContentInput.value !== editingOriginalContent && !window.confirm('角色卡还有未保存的修改，确定放弃吗？')) return;
    roleEditor.close();
  }

  function openEditor(role) {
    editingRoleName = role.name;
    editingExpectedContent = String(role.content || '');
    editorTitle.textContent = `编辑「${role.name}」`;
    roleContentInput.value = editingExpectedContent;
    editingOriginalContent = roleContentInput.value;
    updateCharCount();
    roleEditor.showModal();
    roleContentInput.focus();
  }

  async function loadData(preferredKey) {
    setBusy(true);
    notice.textContent = '正在读取角色卡和 QQ 会话…';
    try {
      const data = await window.dsbotRoles.load();
      roleList = Array.isArray(data.roles) ? data.roles : [];
      sessionList = Array.isArray(data.sessions) ? data.sessions : [];
      renderSessions(preferredKey ?? sessionSelect.value);
      notice.textContent = `已加载 ${roleList.length} 张角色卡、${sessionList.length} 个活动会话。`;
    } catch (error) {
      roleList = [];
      sessionList = [];
      renderSessions();
      notice.textContent = `读取失败：${error?.message || error}`;
      cards.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '请确认 QQ Bridge 正在运行，然后点击“刷新列表”。';
      cards.append(empty);
    } finally {
      setBusy(false);
    }
  }

  sessionSelect.addEventListener('change', updateSelectedRole);
  refreshButton.addEventListener('click', () => loadData(sessionSelect.value));
  roleContentInput.addEventListener('input', updateCharCount);
  cancelEditButton.addEventListener('click', closeEditor);
  closeEditorButton.addEventListener('click', closeEditor);
  roleEditor.addEventListener('cancel', (event) => {
    if (roleContentInput.value !== editingOriginalContent) {
      event.preventDefault();
      closeEditor();
    }
  });
  roleEditor.addEventListener('close', () => {
    editingRoleName = null;
    editingOriginalContent = '';
    editingExpectedContent = '';
  });
  saveEditButton.addEventListener('click', async () => {
    const content = roleContentInput.value;
    if (!editingRoleName || busy) return;
    if (!content.trim()) {
      notice.textContent = '角色卡内容不能为空。';
      roleContentInput.focus();
      return;
    }
    if (content.length > MAX_ROLE_CHARS) {
      notice.textContent = `角色卡内容不能超过 ${MAX_ROLE_CHARS.toLocaleString('zh-CN')} 个字符。`;
      return;
    }
    if (content === editingOriginalContent) {
      roleEditor.close();
      notice.textContent = '内容没有变化。';
      return;
    }
    const name = editingRoleName;
    setBusy(true);
    notice.textContent = `正在保存「${name}」…`;
    try {
      const saved = await window.dsbotRoles.saveRole({ name, content, expectedContent: editingExpectedContent });
      roleList = roleList.map((role) => role.name === saved.name ? { ...role, content: saved.content } : role);
      roleEditor.close();
      renderRoles();
      notice.textContent = `「${name}」已保存；使用该角色的会话会在下一条消息读取新设定。`;
    } catch (error) {
      notice.textContent = `保存失败：${error?.message || error}`;
    } finally {
      setBusy(false);
    }
  });
  applyButton.addEventListener('click', async () => {
    const session = currentSession();
    if (!session || selectedRole === session.role || busy) return;
    setBusy(true);
    notice.textContent = '正在切换角色并创建新的 DSH 会话…';
    try {
      const result = await window.dsbotRoles.switchRole({ key: session.key, role: selectedRole });
      notice.textContent = result.changed
        ? `已切换为${selectedRole ? `“${selectedRole}”` : '默认人格'}；${result.archived ? '旧 DSH 会话已归档，新会话已创建。' : '新会话已就绪。'}`
        : '该会话已使用所选角色。';
      await loadData(session.key);
    } catch (error) {
      notice.textContent = `切换失败：${error?.message || error}`;
    } finally {
      setBusy(false);
    }
  });

  loadData();
})();
