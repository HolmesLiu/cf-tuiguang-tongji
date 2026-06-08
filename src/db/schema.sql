-- =====================================================
-- cf推广统计 D1 Schema (v0.2.0)
-- 10 张表，遵循"少表、宽表、必要时 JSON 兜底"原则
-- =====================================================

-- 1. 后台管理员
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL COLLATE BINARY,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 2. 系统配置（钉钉参数等，固定单行 id=1）
CREATE TABLE IF NOT EXISTS config (
  id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dingtalk_corp_id         TEXT,
  dingtalk_app_key         TEXT,
  dingtalk_app_secret      TEXT,
  dingtalk_agent_id        TEXT,
  dingtalk_access_token    TEXT,
  dingtalk_token_expires   INTEGER,
  default_message_type     TEXT DEFAULT 'work_notification',
  updated_at               INTEGER NOT NULL
);

-- 3. 钉钉部门
CREATE TABLE IF NOT EXISTS departments (
  dept_id    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  parent_id  INTEGER,
  path       TEXT,
  synced_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dept_parent ON departments(parent_id);

-- 4. 钉钉员工（推广人）
CREATE TABLE IF NOT EXISTS users (
  userid     TEXT    PRIMARY KEY COLLATE BINARY,
  name       TEXT    NOT NULL,
  mobile     TEXT,
  avatar     TEXT,
  dept_id    INTEGER,
  dept_path  TEXT,
  title      TEXT,
  is_active  INTEGER DEFAULT 1,
  synced_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_dept   ON users(dept_id);
CREATE INDEX IF NOT EXISTS idx_user_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_name   ON users(name);

-- 5. 推广任务
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT    PRIMARY KEY,
  title            TEXT,
  original_url     TEXT    NOT NULL,
  original_content TEXT,
  receivers_json   TEXT    NOT NULL,
  message_type     TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'draft',
  polished_json    TEXT,
  created_by       TEXT    NOT NULL,
  creator_id       TEXT,
  source           TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  published_at     INTEGER,
  deleted_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_task_deleted_at ON tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_task_creator    ON tasks(creator_id);

-- 6. 任务-推广人 中间表
CREATE TABLE IF NOT EXISTS task_targets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT    NOT NULL,
  userid            TEXT    NOT NULL,
  short_code        TEXT    UNIQUE,
  short_url         TEXT,
  qr_r2_key         TEXT,
  copy_used         TEXT,
  copy_type         TEXT,
  dingtalk_msg_id   TEXT,
  sent_at           INTEGER,
  send_status       TEXT    DEFAULT 'pending',
  send_error        TEXT,
  UNIQUE(task_id, userid)
);
CREATE INDEX IF NOT EXISTS idx_target_task ON task_targets(task_id);
CREATE INDEX IF NOT EXISTS idx_target_user ON task_targets(userid);
CREATE INDEX IF NOT EXISTS idx_target_code ON task_targets(short_code);

-- 7. 点击日志
CREATE TABLE IF NOT EXISTS click_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code   TEXT    NOT NULL,
  task_id      TEXT    NOT NULL,
  userid       TEXT    NOT NULL,
  clicked_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  browser      TEXT,
  os           TEXT,
  device_type  TEXT,
  referer      TEXT,
  country      TEXT,
  city         TEXT
);
CREATE INDEX IF NOT EXISTS idx_click_task ON click_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_click_user ON click_logs(userid);
CREATE INDEX IF NOT EXISTS idx_click_code ON click_logs(short_code);
CREATE INDEX IF NOT EXISTS idx_click_time ON click_logs(clicked_at);

-- 8. 归档任务
CREATE TABLE IF NOT EXISTS archived_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      TEXT    NOT NULL,
  snapshot     TEXT    NOT NULL,
  archived_at  INTEGER NOT NULL,
  archived_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_arch_task ON archived_tasks(task_id);

-- 9. API Key
CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  key_hash      TEXT    NOT NULL,
  key_prefix    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  is_active     INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_key_hash ON api_keys(key_hash);

-- 10. 管理员 Session
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT    PRIMARY KEY,
  admin_id    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sess_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sess_expires ON admin_sessions(expires_at);

-- =====================================================
-- 11. 推广人 User Access Token（OAuth 授权后存储）
-- 用于调用钉钉新版个人待办 API
-- =====================================================
CREATE TABLE IF NOT EXISTS user_tokens (
  userid        TEXT    PRIMARY KEY,
  access_token  TEXT    NOT NULL,
  refresh_token TEXT    NOT NULL,
  expires_at    INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  scope         TEXT,
  union_id      TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_expires ON user_tokens(expires_at);

-- =====================================================
-- 初始化：插入默认 config 行
-- =====================================================
INSERT OR IGNORE INTO config (id, default_message_type, updated_at)
VALUES (1, 'work_notification', unixepoch() * 1000);
