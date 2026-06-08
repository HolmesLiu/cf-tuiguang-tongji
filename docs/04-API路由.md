# API 路由

> 路由分类与清单
> 路径前缀：管理后台（Cookie 鉴权）、Agent（API Key 鉴权）、短链中转（公开）

---

## 路由总览

| 路径前缀 | 用途 | 鉴权 |
|---|---|---|
| `/*`（除了下面这些） | 静态资源（HTML/JS/CSS） | 无 |
| `/api/admin/*` | 后台管理 API | Cookie Session |
| `/api/agent/*` | Agent API | `X-API-Key` Header |
| `/s/:code` | 短链跳转 + 埋点 | 无 |
| `/qr/:file` | 二维码图片代理 | 无 |
| `/login` | 登录页 | 无 |
| `/logout` | 登出 | Cookie |
| `/dashboard` | 仪表盘 | Cookie |
| `/tasks` | 任务列表 | Cookie |
| `/tasks/:id` | 任务详情 | Cookie |
| `/archive` | 回收站 | Cookie |
| `/users` | 推广人 | Cookie |
| `/settings` | 系统配置 | Cookie |
| `/api-keys` | API Key 管理 | Cookie |

---

## 鉴权说明

### 后台 Cookie Session
```
登录 → 服务端 set-cookie (HttpOnly, Secure, SameSite=Strict)
     → 客户端每次请求自动带 cookie
     → 服务端查 admin_sessions 验证
```

### Agent API Key
```
Header: X-API-Key: <key>
     → 服务端 SHA-256 哈希后比对 api_keys.key_hash
     → 校验通过放行，更新 last_used_at
```

API Key 通过 `wrangler secret put AGENT_API_KEY` 配置到 Worker 环境变量。
也可以在后台管理多个 API Key（多 key 轮换）。

---

## 管理后台 API 详细

### 认证
```
POST   /api/admin/login
       body: { username, password }
       → set-cookie + { ok: true }

POST   /api/admin/logout
       → 清 cookie + 删 session

GET    /api/admin/me
       → { id, username }
```

### 系统配置
```
GET    /api/config
       → 返回 config 行（含脱敏的钉钉密钥：app_secret 显示前 4 + ****）

PUT    /api/config
       body: { dingtalk_corp_id, dingtalk_app_key, dingtalk_app_secret, dingtalk_agent_id, default_message_type }
       → 写 config，清空 access_token（强制下次重新拉）
```

### 钉钉通讯录
```
POST   /api/contacts/sync
       → 异步触发全量同步，返回 { job_id }
       → 同步过程中 status = 'running'

GET    /api/contacts/sync/status
       → { status, last_synced_at, progress, error }

GET    /api/departments
       → 部门树

GET    /api/users
       query: ?q=张三&dept_id=1&is_active=1&page=1&page_size=20
       → 推广人列表（分页）
```

### 任务管理
```
GET    /api/tasks
       query: ?status=published&page=1&page_size=20&include_deleted=false
       → 任务列表

POST   /api/tasks
       body: { title, original_url, original_content, receivers_json, message_type, polished_json }
       → 创建任务（status=draft），返回 task

GET    /api/tasks/:id
       → 任务详情（含 task_targets 列表）

PUT    /api/tasks/:id
       → 仅 draft 状态可编辑

DELETE /api/tasks/:id
       → 软删：deleted_at = now()，移到归档

POST   /api/tasks/:id/publish
       → 触发发布流程：生成短链 + 二维码 + 推钉钉
       → 异步执行，返回 { task_id, status }

GET    /api/tasks/:id/stats
       → 统计数据（见下方）

GET    /api/tasks/:id/targets
       → 该任务的推广人列表（含 send_status）

GET    /api/tasks/:id/targets/:userid/clicks
       query: ?page=1&page_size=50
       → 某推广人点击详单
```

### 统计响应结构
```json
{
  "task_id": "abc123",
  "summary": {
    "total_clicks": 1280,
    "unique_ips": 342,
    "unique_promoters": 12,
    "total_promoters": 15
  },
  "by_device": { "mobile": 1100, "pc": 180 },
  "by_country": { "CN": 1200, "US": 80 },
  "by_hour": [ /* 24 项 */ ],
  "by_day": [ /* 日期数组 */ ],
  "by_browser": { "Chrome": 600, "WeChat": 400, "Safari": 200 },
  "promoter_ranking": [
    { "userid": "zhangsan", "name": "张三", "clicks": 200, "unique_ips": 80 }
  ]
}
```

### 归档管理
```
GET    /api/archive
       → 归档任务列表

POST   /api/archive/:taskId/restore
       → 还原到 tasks 表

DELETE /api/archive/:taskId
       → 彻底删除（物理删除）
```

### API Key 管理
```
GET    /api/api-keys
       → 列表（不含明文 key）

POST   /api/api-keys
       body: { name }
       → 创建，**只此一次返回明文 key**

DELETE /api/api-keys/:id
       → 吊销（is_active=0）
```

---

## Agent API 详细

API Key 鉴权（`X-API-Key` header）。

```
POST   /api/agent/tasks
       body: { title, original_url, original_content, receivers_json, message_type, polished_json }
       → 创建任务（created_by='agent', source='agent'）
       → Agent 负责润色 polished_json 三版本

POST   /api/agent/tasks/:id/publish
       → 发布

GET    /api/agent/tasks
       → 我创建的任务

GET    /api/agent/tasks/:id
       → 任务详情 + 统计

GET    /api/agent/tasks/:id/targets/:userid/clicks
       → 推广人详单

GET    /api/agent/users/search
       query: ?q=张三
       → 搜索推广人（用于 Agent 确认 userid）

GET    /api/agent/departments
       → 部门列表
```

---

## 短链中转（公开）

```
GET    /s/:code
       流程：
         1. 查 KV/D1: short_code → task_target
         2. 拿请求头：cf-connecting-ip, user-agent, referer, cf-ipcountry, cf-ipcity
         3. ua-parser-js 解析
         4. 写 click_logs（异步，不阻塞跳转）
         5. 302 → original_url
       失败：404 + 友好提示页

GET    /qr/:filename
       → 代理 R2 返回二维码 PNG
       → 设 Cache-Control: public, max-age=86400
```

---

## 错误响应规范

所有 API 错误统一返回：

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "任务不存在或已删除",
    "details": {}
  }
}
```

常见错误码：
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `VALIDATION_ERROR` (400)
- `DINGTALK_API_ERROR` (502)
- `INTERNAL_ERROR` (500)

成功响应：
```json
{ "ok": true, "data": {...} }
```

---

## 中间件

```ts
// auth/admin.ts
export const requireAdmin = async (req) => {
  const cookie = parseCookie(req.headers.get('cookie'));
  const session = await getSession(cookie.session_id);
  if (!session || session.expires_at < Date.now()) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }
  return { ok: true, admin: session.admin };
};

// auth/apiKey.ts
export const requireApiKey = async (req, env) => {
  const key = req.headers.get('X-API-Key');
  if (!key) return { ok: false, status: 401 };
  const hash = await sha256(key);
  const apiKey = await findApiKey(env.DB, hash);
  if (!apiKey || !apiKey.is_active) return { ok: false, status: 401 };
  await touchApiKey(env.DB, apiKey.id);
  return { ok: true, key: apiKey };
};
```

---

_2026-06-08｜娜娜子 🌸_
