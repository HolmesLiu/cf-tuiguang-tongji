// cf推广统计 - 后台管理 SPA
// 原生 JS，无依赖

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ============ 全局错误展示 ============
// 任何 JS 错误都会显示在页面顶部红色 banner，下次有 bug 一眼就能看到
function showErrorBanner(msg, detail) {
  let banner = document.getElementById('__error_banner__');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '__error_banner__';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#d70015;color:white;padding:12px 20px;z-index:99999;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-all;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    document.body.appendChild(banner);
  }
  banner.textContent = '⚠️ ' + msg + (detail ? '\n' + detail : '');
}
window.addEventListener('error', (e) => {
  console.error('[error]', e.error);
  showErrorBanner(e.message || 'JS 错误', e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  showErrorBanner('未捕获的 Promise 异常', e.reason?.message || String(e.reason));
});

const api = {
  async req(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...(opts.headers || {}),
      },
      credentials: 'same-origin',
    });
    const data = await r.json().catch(() => ({ ok: false, error: { message: r.statusText } }));
    if (!data.ok) throw new Error(data.error?.message || r.statusText);
    return data.data;
  },
  get(p) { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST', body: JSON.stringify(body) }); },
  put(p, body) { return this.req(p, { method: 'PUT', body: JSON.stringify(body) }); },
  del(p) { return this.req(p, { method: 'DELETE' }); },
};

// ============ 路由 ============
let currentPage = 'dashboard';
function showPage(name) {
  currentPage = name;
  // 重建 .content 容器（如果 openTask 替换了 main）
  const main = $('.main');
  if (main && $$('.content').length === 0) {
    main.innerHTML = mainBackup ?? main.innerHTML;
  }
  $$('.content').forEach((c) => {
    const isActive = c.id === `page-${name}`;
    c.hidden = !isActive;
    c.classList.toggle('active', isActive);
  });
  $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  const renderer = pageRenderers[name];
  if (renderer) renderer();
}
// 挂到 window，让 inline onclick（type="module" 下必须用 window 访问）能调用
window.showPage = showPage;

const pageRenderers = {
  dashboard: renderDashboard,
  tasks: renderTasks,
  'new-task': () => {},
  users: renderUsers,
  archive: renderArchive,
  'api-keys': renderApiKeys,
  settings: renderSettings,
};

// ============ 登录 ============
async function checkAuth() {
  try {
    const { admin } = await api.get('/api/admin/me');
    showApp(admin);
  } catch {
    showLogin();
  }
}

function showLogin() {
  $('#login-page').hidden = false;
  $('#app-page').hidden = true;
}

function showApp(admin) {
  $('#login-page').hidden = true;
  $('#app-page').hidden = false;
  $('#user-info').textContent = `👤 ${admin.username}`;
  showPage('dashboard');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  const errEl = $('#login-error');
  errEl.hidden = true;
  try {
    await api.post('/api/admin/login', { username, password });
    checkAuth();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api.post('/api/admin/logout');
  showLogin();
});

// ============ 导航 ============
$$('.nav-item').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(a.dataset.page);
  });
});

// ============ 仪表盘 ============
async function renderDashboard() {
  const el = $('#dashboard-stats');
  el.innerHTML = '加载中...';
  try {
    const { tasks: allTasks, total } = await api.get('/api/tasks?page=1&page_size=1000');
    const recent = allTasks.slice(0, 5);
    const published = allTasks.filter(t => t.status === 'published').length;
    const draft = allTasks.filter(t => t.status === 'draft').length;
    el.innerHTML = `
      <div class="stat-card"><div class="label">总任务数</div><div class="value">${total}</div></div>
      <div class="stat-card"><div class="label">已发布</div><div class="value">${published}</div></div>
      <div class="stat-card"><div class="label">草稿</div><div class="value">${draft}</div></div>
      <div class="stat-card"><div class="label">今日活跃</div><div class="value">-</div></div>
      <div class="detail-section" style="grid-column: 1 / -1;">
        <h3>最近任务</h3>
        <table>
          <thead><tr><th>标题</th><th>状态</th><th>原链接</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>${recent.map(taskRow).join('') || '<tr><td colspan="5" style="text-align:center;color:#86868b;">暂无任务</td></tr>'}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

function taskRow(t) {
  return `<tr>
    <td>${esc(t.title || '(无标题)')}</td>
    <td><span class="status-pill status-${t.status}">${statusLabel(t.status)}</span></td>
    <td><a href="${esc(t.original_url)}" target="_blank">${esc(t.original_url.slice(0, 40))}${t.original_url.length > 40 ? '...' : ''}</a></td>
    <td>${fmtTime(t.created_at)}</td>
    <td>
      <button class="btn-secondary" onclick="openTask('${esc(t.id)}')">查看</button>
    </td>
  </tr>`;
}

function statusLabel(s) {
  return { draft: '草稿', published: '已发布', archived: '已归档' }[s] ?? s;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

// ============ 任务列表 ============
async function renderTasks() {
  const el = $('#tasks-list');
  el.innerHTML = '加载中...';
  try {
    const { tasks } = await api.get('/api/tasks?page=1&page_size=100');
    el.innerHTML = `
      <table>
        <thead><tr><th>标题</th><th>状态</th><th>原链接</th><th>接收方</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>${tasks.map(t => `
          <tr>
            <td>${esc(t.title || '(无标题)')}</td>
            <td><span class="status-pill status-${t.status}">${statusLabel(t.status)}</span></td>
            <td><a href="${esc(t.original_url)}" target="_blank">${esc(t.original_url.slice(0, 30))}…</a></td>
            <td>${(JSON.parse(t.receivers_json).users.length + JSON.parse(t.receivers_json).departments.length)} 项</td>
            <td>${fmtTime(t.created_at)}</td>
            <td>
              <button class="btn-secondary" onclick="openTask('${esc(t.id)}')">详情</button>
              ${t.status === 'draft' ? `<button class="btn-primary" onclick="publishTask('${esc(t.id)}')">发布</button>` : ''}
              ${t.status !== 'archived' ? `<button class="btn-danger" onclick="deleteTask('${esc(t.id)}')">归档</button>` : ''}
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

let mainBackup = null;

window.openTask = async function (id) {
  const t = await api.get('/api/tasks/' + id);
  const stats = await api.get('/api/tasks/' + id + '/stats');
  const main = $('.main');
  // 备份原始 main（只在第一次进入详情页时备份）
  if (mainBackup === null) mainBackup = main.innerHTML;
  main.innerHTML = `
    <a href="#" id="back-to-list-link">← 返回列表</a>
    <h1>${esc(t.task.title || '(无标题)')}</h1>
    <div class="detail-section">
      <h3>任务信息</h3>
      <div class="kv-row"><div class="k">ID</div><div class="v">${esc(t.task.id)}</div></div>
      <div class="kv-row"><div class="k">状态</div><div class="v"><span class="status-pill status-${t.task.status}">${statusLabel(t.task.status)}</span></div></div>
      <div class="kv-row"><div class="k">原链接</div><div class="v"><a href="${esc(t.task.original_url)}" target="_blank">${esc(t.task.original_url)}</a></div></div>
      <div class="kv-row"><div class="k">原内容</div><div class="v">${esc(t.task.original_content || '(空)')}</div></div>
      <div class="kv-row"><div class="k">消息类型</div><div class="v">${t.task.message_type === 'work_notification' ? '工作通知' : '个人待办'}</div></div>
      <div class="kv-row"><div class="k">创建时间</div><div class="v">${fmtTime(t.task.created_at)}</div></div>
      ${t.task.published_at ? `<div class="kv-row"><div class="k">发布时间</div><div class="v">${fmtTime(t.task.published_at)}</div></div>` : ''}
    </div>
    ${t.task.status === 'published' ? renderStatsSection(stats.stats) : ''}
    <div class="detail-section">
      <h3>推广人 (${t.targets.length})</h3>
      <table>
        <thead><tr><th>姓名</th><th>userid</th><th>短码</th><th>推送状态</th><th>错误</th></tr></thead>
        <tbody>${t.targets.map(tg => `
          <tr>
            <td>${esc(tg.name)}</td>
            <td>${esc(tg.userid)}</td>
            <td><code>${esc(tg.short_code || '-')}</code></td>
            <td><span class="status-pill status-${tg.send_status === 'success' ? 'published' : (tg.send_status === 'failed' ? 'archived' : 'draft')}">${tg.send_status}</span></td>
            <td>${esc(tg.send_error || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  // 绑定返回列表按钮
  const backLink = document.getElementById('back-to-list-link');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      const main = $('.main');
      if (mainBackup !== null) {
        main.innerHTML = mainBackup;
        mainBackup = null;
      }
      showPage('tasks');
    });
  }
};

function renderStatsSection(s) {
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">总点击</div><div class="value">${s.summary.total_clicks}</div></div>
      <div class="stat-card"><div class="label">独立 IP</div><div class="value">${s.summary.unique_ips}</div></div>
      <div class="stat-card"><div class="label">活跃推广人</div><div class="value">${s.summary.unique_promoters}</div></div>
      <div class="stat-card"><div class="label">总推广人</div><div class="value">${s.summary.total_promoters}</div></div>
    </div>
    <div class="detail-section">
      <h3>推广人排行（按独立 IP）</h3>
      <table>
        <thead><tr><th>排名</th><th>姓名</th><th>userid</th><th>点击</th><th>独立 IP</th></tr></thead>
        <tbody>${s.promoter_ranking.map((p, i) => `
          <tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.userid)}</td><td>${p.clicks}</td><td>${p.unique_ips}</td></tr>
        `).join('')}</tbody>
      </table>
    </div>
  `;
}

window.publishTask = async function (id) {
  if (!confirm('确认发布此任务？将向所有接收方推送钉钉消息。')) return;
  try {
    const { result } = await api.post('/api/tasks/' + id + '/publish');
    alert(`发布完成：成功 ${result.sent_success} / 失败 ${result.sent_failed}`);
    renderTasks();
  } catch (e) {
    alert('发布失败：' + e.message);
  }
};

window.deleteTask = async function (id) {
  if (!confirm('确认归档此任务？可从回收站还原。')) return;
  try {
    await api.del('/api/tasks/' + id);
    renderTasks();
  } catch (e) {
    alert('归档失败：' + e.message);
  }
};

// ============ 新建任务 ============
$('#new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const users = f.users.value.split(',').map(s => s.trim()).filter(Boolean);
  const departments = f.departments.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const body = {
    title: f.title.value || null,
    original_url: f.original_url.value,
    original_content: f.original_content.value || null,
    message_type: f.message_type.value,
    receivers: { users, departments },
    polished: {
      friend_circle: f.polished_friend_circle.value,
      group: f.polished_group.value,
      private: f.polished_private.value,
    },
  };
  const result = $('#new-task-result');
  result.hidden = true;
  try {
    const { task } = await api.post('/api/tasks', body);
    result.style.background = '#d1f4e0';
    result.style.color = '#00875a';
    result.style.borderColor = '#a3e3c1';
    result.textContent = `✅ 草稿已保存：${task.id}`;
    result.hidden = false;
    setTimeout(() => showPage('tasks'), 1500);
  } catch (e) {
    result.textContent = e.message;
    result.hidden = false;
  }
});

// ============ 推广人 ============
async function renderUsers() {
  const q = $('#user-search').value;
  const el = $('#users-list');
  el.innerHTML = '加载中...';
  try {
    const { users, total } = await api.get('/api/users?q=' + encodeURIComponent(q) + '&page=1&page_size=100');
    el.innerHTML = `
      <p class="hint">共 ${total} 个推广人</p>
      <table>
        <thead><tr><th>姓名</th><th>userid</th><th>部门</th><th>手机</th><th>状态</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${esc(u.name)}</td>
            <td>${esc(u.userid)}</td>
            <td>${esc(u.dept_path || '-')}</td>
            <td>${esc(u.mobile || '-')}</td>
            <td>${u.is_active ? '✅ 在职' : '❌ 离职'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

$('#user-search').addEventListener('input', debounce(renderUsers, 300));
$('#sync-btn').addEventListener('click', async () => {
  const status = $('#sync-status');
  status.textContent = '启动同步...';
  try {
    // while 循环：反复调后端 /api/contacts/sync
    // 后端单次调用会跑尽可能多批（受 25s wall time 限制）
    // 调一次拿到最新 state；pending 就再调（前端排队，CF Worker 串行处理）
    let state = null;
    let rounds = 0;
    while (true) {
      const r = await api.post('/api/contacts/sync');
      state = r.state;
      rounds++;
      status.textContent = `🔄 第 ${rounds} 轮：${state.syncedDepts} 部门 / ${state.syncedUsers} 用户，队列剩 ${state.queueLength}`;
      if (state.status === 'done') {
        status.textContent = `✅ 同步完成：${state.syncedDepts} 部门，${state.syncedUsers} 用户（共 ${rounds} 轮）`;
        renderUsers();
        break;
      }
      if (state.status === 'error') {
        status.textContent = '❌ 同步出错：' + (state.error || '未知错误');
        break;
      }
      // pending 状态：后端在单次 invocation 跑了多批，但还没完成
      // 继续触发（后端会接着推进）
    }
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ============ 归档 ============
async function renderArchive() {
  const el = $('#archive-list');
  el.innerHTML = '加载中...';
  try {
    const { archived } = await api.get('/api/archive');
    if (archived.length === 0) {
      el.innerHTML = '<p class="hint">归档为空</p>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>任务标题</th><th>原链接</th><th>归档时间</th><th>归档人</th><th>操作</th></tr></thead>
        <tbody>${archived.map(a => `
          <tr>
            <td>${esc(a.title || '(无标题)')}</td>
            <td>${esc((a.original_url || '').slice(0, 40))}…</td>
            <td>${fmtTime(a.archived_at)}</td>
            <td>${esc(a.archived_by || '')}</td>
            <td>
              <button class="btn-secondary" onclick="restoreTask('${esc(a.task_id)}')">还原</button>
              <button class="btn-danger" onclick="hardDelete('${esc(a.task_id)}')">彻底删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

window.restoreTask = async function (id) {
  if (!confirm('确认还原？任务将回到草稿状态。')) return;
  await api.post('/api/archive/' + id + '/restore');
  renderArchive();
};

window.hardDelete = async function (id) {
  if (!confirm('⚠️ 彻底删除将无法恢复！确认？')) return;
  await api.del('/api/archive/' + id);
  renderArchive();
};

// ============ API Key ============
async function renderApiKeys() {
  const el = $('#api-keys-list');
  el.innerHTML = '加载中...';
  try {
    const { keys } = await api.get('/api/api-keys');
    el.innerHTML = `
      <table>
        <thead><tr><th>名称</th><th>前缀</th><th>状态</th><th>创建时间</th><th>最后使用</th><th>操作</th></tr></thead>
        <tbody>${keys.map(k => `
          <tr>
            <td>${esc(k.name)}</td>
            <td><code>${esc(k.key_prefix)}...</code></td>
            <td>${k.is_active ? '✅ 启用' : '❌ 已吊销'}</td>
            <td>${fmtTime(k.created_at)}</td>
            <td>${k.last_used_at ? fmtTime(k.last_used_at) : '-'}</td>
            <td>${k.is_active ? `<button class="btn-danger" onclick="revokeKey('${k.id}')">吊销</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

window.revokeKey = async function (id) {
  if (!confirm('确认吊销此 API Key？')) return;
  await api.del('/api/api-keys/' + id);
  renderApiKeys();
};

$('#create-key-btn').addEventListener('click', async () => {
  const name = $('#api-key-name').value.trim();
  if (!name) { alert('请输入名称'); return; }
  try {
    const { plain_key, api_key } = await api.post('/api/api-keys', { name });
    const box = $('#new-key-display');
    box.innerHTML = `<strong>新 Key（请立即保存，关闭后无法再次查看）：</strong><br><br><code>${esc(plain_key)}</code>`;
    box.hidden = false;
    $('#api-key-name').value = '';
    renderApiKeys();
  } catch (e) {
    alert('创建失败：' + e.message);
  }
});

// ============ 设置 ============
async function renderSettings() {
  try {
    const { config } = await api.get('/api/config');
    const f = $('#config-form');
    f.dingtalk_corp_id.value = config?.dingtalk_corp_id ?? '';
    f.dingtalk_app_key.value = config?.dingtalk_app_key ?? '';
    f.dingtalk_app_secret.value = '';
    f.dingtalk_agent_id.value = config?.dingtalk_agent_id ?? '';
    f.default_message_type.value = config?.default_message_type ?? 'work_notification';
  } catch (e) {
    alert('加载配置失败：' + e.message);
  }
}

$('#config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    dingtalk_corp_id: f.dingtalk_corp_id.value,
    dingtalk_app_key: f.dingtalk_app_key.value,
    dingtalk_agent_id: f.dingtalk_agent_id.value,
    default_message_type: f.default_message_type.value,
  };
  if (f.dingtalk_app_secret.value) body.dingtalk_app_secret = f.dingtalk_app_secret.value;
  const r = $('#config-result');
  try {
    await api.put('/api/config', body);
    r.style.color = '#00875a';
    r.textContent = '✅ 保存成功';
    renderSettings();
  } catch (e) {
    r.style.color = '#d70015';
    r.textContent = '❌ ' + e.message;
  }
});

// ============ 启动 ============
checkAuth();
