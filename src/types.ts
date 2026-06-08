/**
 * 全局类型定义
 */

// ============ Cloudflare Bindings ============
export interface Env {
  // Bindings
  DB: D1Database;
  QR_BUCKET: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;

  // Vars（非敏感）
  DEFAULT_MESSAGE_TYPE: string;
  SHORT_URL_BASE: string;

  // Secrets（敏感）
  DINGTALK_CORP_ID?: string;
  DINGTALK_APP_KEY?: string;
  DINGTALK_APP_SECRET?: string;
  DINGTALK_AGENT_ID?: string;
  AGENT_API_KEY?: string;
  SESSION_SECRET?: string;
}

// ============ 业务实体 ============

export type MessageType = 'work_notification' | 'todo';
export type TaskStatus = 'draft' | 'published' | 'archived';
export type CopyType = 'friend_circle' | 'group' | 'private';
export type SendStatus = 'pending' | 'success' | 'failed';

export interface Admin {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
  last_login_at: number | null;
}

export interface AdminSession {
  token: string;
  admin_id: number;
  created_at: number;
  expires_at: number;
  ip: string | null;
}

export interface DingtalkDepartment {
  dept_id: number;
  name: string;
  parent_id: number | null;
  path: string;
  synced_at: number;
}

export interface DingtalkUser {
  userid: string;
  name: string;
  mobile: string | null;
  avatar: string | null;
  dept_id: number | null;
  dept_path: string;
  title: string | null;
  is_active: number;
  synced_at: number;
}

export interface Receivers {
  users: string[];      // userid 列表
  departments: number[]; // dept_id 列表
}

export interface PolishedCopy {
  friend_circle: string;
  group: string;
  private: string;
}

export interface Task {
  id: string;
  title: string | null;
  original_url: string;
  original_content: string | null;
  receivers_json: string;
  message_type: MessageType;
  status: TaskStatus;
  polished_json: string | null;
  created_by: string;
  creator_id: string | null;
  source: 'agent' | 'dashboard';
  created_at: number;
  updated_at: number;
  published_at: number | null;
  deleted_at: number | null;
}

export interface TaskTarget {
  id: number;
  task_id: string;
  userid: string;
  short_code: string | null;
  short_url: string | null;
  qr_r2_key: string | null;
  copy_used: string | null;
  copy_type: CopyType | null;
  dingtalk_msg_id: string | null;
  sent_at: number | null;
  send_status: SendStatus;
  send_error: string | null;
}

export interface ClickLog {
  id: number;
  short_code: string;
  task_id: string;
  userid: string;
  clicked_at: number;
  ip: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  referer: string | null;
  country: string | null;
  city: string | null;
}

export interface ApiKey {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  is_active: number;
}

export interface Config {
  id: number;
  dingtalk_corp_id: string | null;
  dingtalk_app_key: string | null;
  dingtalk_app_secret: string | null;
  dingtalk_agent_id: string | null;
  dingtalk_access_token: string | null;
  dingtalk_token_expires: number | null;
  default_message_type: string;
  updated_at: number;
}

export interface ArchivedTask {
  id: number;
  task_id: string;
  snapshot: string;
  archived_at: number;
  archived_by: string | null;
}

// ============ 钉钉 API 响应 ============

export interface DingtalkAccessTokenResponse {
  errcode: number;
  errmsg: string;
  access_token?: string;
  expires_in?: number;
}

export interface DingtalkDeptListResponse {
  errcode: number;
  errmsg: string;
  result: {
    has_more: boolean;
    next_cursor: number;
    dept_id: number;
    list: Array<{
      dept_id: number;
      name: string;
      parent_id: number;
      create_dept_group: boolean;
    }>;
  };
}

export interface DingtalkUserListResponse {
  errcode: number;
  errmsg: string;
  result: {
    has_more: boolean;
    next_cursor: number;
    list: Array<{
      userid: string;
      name: string;
      mobile: string;
      avatar: string;
      dept_id_list: number[];
      admin: boolean;
      active: boolean;
      title: string | null;
    }>;
  };
}

// ============ HTTP 响应辅助 ============

export type ApiResponse<T = unknown> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  admin?: Admin;       // 当前登录管理员（中间件注入）
  apiKey?: ApiKey;     // 当前 API Key（中间件注入）
}
