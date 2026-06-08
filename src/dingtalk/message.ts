/**
 * 钉钉工作通知
 * 文档：https://open.dingtalk.com/document/orgapp/asynsendmessage_1
 */

import type { Env } from '../types.ts';
import { dtPost } from './client.ts';

export interface WorkNotificationResult {
  errcode: number;
  errmsg: string;
  task_id?: number;
  request_id?: string;
}

/**
 * 发送工作通知（agentid 单个）
 */
export async function sendWorkNotification(
  env: Env,
  useridList: string[],
  content: NotificationContent
): Promise<WorkNotificationResult> {
  if (!env.DINGTALK_AGENT_ID) throw new Error('DINGTALK_AGENT_ID 未配置');
  if (useridList.length === 0) throw new Error('userid 列表为空');

  const body = {
    msg: {
      msgtype: 'markdown',
      markdown: {
        title: content.title,
        text: content.markdown,
      },
    },
    agent_id: parseInt(env.DINGTALK_AGENT_ID, 10),
    userid_list: useridList.join(','),
    to_all_user: false,
  };

  return dtPost<WorkNotificationResult>(env, '/topapi/message/corpconversation/asyncsend_v2', body);
}

export interface NotificationContent {
  title: string;
  markdown: string;
}

/**
 * 构建推广通知内容（markdown）
 */
export function buildPromotionMarkdown(input: {
  title: string;
  shortUrl: string;
  qrUrl: string;
  originalUrl: string;
  originalContent: string;
  copyFriendCircle: string;
  copyGroup: string;
  copyPrivate: string;
}): string {
  // 不嵌图片（钉钉工作通知的 markdown ![]() 不渲染 SVG）
  // 推广人想要二维码：点 H5 详情页查看
  // shortUrl: https://tuiguang.7kk.top/s/ABCDEFGH
  // h5Url:   https://tuiguang.7kk.top/h5/p/ABCDEFGH
  const h5Url = input.shortUrl.replace(/\/s\//, '/h5/p/');
  return `### 📣 推广任务：${input.title}

> **原始内容**：${input.originalContent || '（无）'}
> **原始链接**：[${truncate(input.originalUrl, 50)}](${input.originalUrl})

---

#### 🎯 你的专属推广链接

**短链**（推荐）：${input.shortUrl}

> 👆 点开后是你要推广的原始页面
> （点击会被本平台统计为「你的推广」）

**📱 推广素材（文案+二维码）**：[点这里查看](${h5Url})

> 看到二维码后长按图片 → 保存到相册 → 去微信/朋友圈发送

---

#### ✍️ 推广文案（三选一）

##### 📱 朋友圈版
${input.copyFriendCircle}

##### 👥 群发版
${input.copyGroup}

##### 💬 私聊版
${input.copyPrivate}

---

> 本推广链接专属你的，**可独立统计推广效果**。
> 平台：cf推广统计 · 你的每一次点击都被记录 🌸
`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
