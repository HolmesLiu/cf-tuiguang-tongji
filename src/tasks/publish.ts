/**
 * 任务发布流程
 * 1. 接收方规则展开（user + dept → 最终 userid 列表，去重）
 * 2. 对每个推广人：
 *    a. 生成 short_code（如果重试则换码）
 *    b. 拼 short_url
 *    c. 生成二维码 → 存 R2
 *    d. 选定 copy_type（默认朋友圈版，可后续调整）
 * 3. 写入 task_targets
 * 4. 调钉钉 API 推送
 * 5. 更新 task status → 'published'
 */

import { nanoid } from 'nanoid';
import type { Env, PolishedCopy, Receivers, CopyType, Task, MessageType } from '../types.ts';
import {
  createTarget,
  getTask,
  getUsersByDept,
  markTaskPublished,
  updateTarget,
  listTargetsByTask,
  getTargetByCode,
} from '../db/queries.ts';
import { getSubDepartments } from '../dingtalk/contacts.ts';
import { makeShortCode, buildShortUrl, buildQrR2Key } from '../links/shortener.ts';
import { generateAndStoreQr, buildQrPublicUrl } from '../links/qrcode.ts';
import { sendWorkNotification, buildPromotionMarkdown } from '../dingtalk/message.ts';
import { addWorkrecord } from '../dingtalk/workrecord.ts';
import { safeJson } from '../utils/json.ts';

export interface PublishResult {
  task_id: string;
  total_promoters: number;
  sent_success: number;
  sent_failed: number;
  errors: Array<{ userid: string; error: string }>;
}

/**
 * 发布任务
 */
export async function publishTask(env: Env, taskId: string): Promise<PublishResult> {
  const task = await getTask(env.DB, taskId, true);
  if (!task) throw new Error('Task not found');
  if (task.status === 'published') throw new Error('Task already published');
  if (task.status === 'archived') throw new Error('Task is archived');
  if (!task.polished_json) throw new Error('polished_json 缺失');

  // 1. 展开接收方
  const receivers: Receivers = safeJson(task.receivers_json, { users: [], departments: [] });
  const polished: PolishedCopy = safeJson(task.polished_json, { friend_circle: '', group: '', private: '' });

  // 收集所有 userid
  const useridSet = new Set<string>(receivers.users);
  for (const deptId of receivers.departments) {
    const subDepts = await getSubDepartments(env, deptId);
    const users = await getUsersByDept(env.DB, deptId, subDepts);
    for (const u of users) {
      if (u.is_active) useridSet.add(u.userid);
    }
  }
  const userids = Array.from(useridSet);

  if (userids.length === 0) {
    throw new Error('展开后无推广人（部门下没人？或全是不在职？）');
  }

  // 2. 准备 task_targets（每个推广人一个短链 + 二维码 + 文案）
  const targetsCreated: Array<{
    id: number;
    userid: string;
    short_code: string;
    copy_used: string;
    copy_type: CopyType;
  }> = [];

  for (const userid of userids) {
    // 重试避免短码冲突
    let shortCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeShortCode();
      const existing = await getTargetByCode(env.DB, code);
      if (!existing) {
        shortCode = code;
        break;
      }
    }
    if (!shortCode) throw new Error('短码生成失败（重试 5 次都冲突）');

    const shortUrl = buildShortUrl(env.SHORT_URL_BASE, shortCode);
    const qrUrl = buildQrPublicUrl(env.SHORT_URL_BASE, buildQrR2Key(shortCode));

    // 默认用朋友圈版（最常见）
    const copyType: CopyType = 'friend_circle';
    const copyUsed = polished[copyType] ?? polished.group ?? polished.private;

    // 生成二维码并存 R2
    const r2Key = await generateAndStoreQr(env, shortUrl, shortCode);

    const target = await createTarget(env.DB, {
      task_id: taskId,
      userid,
      short_code: shortCode,
      short_url: shortUrl,
      qr_r2_key: r2Key,
      copy_used: copyUsed,
      copy_type: copyType,
      dingtalk_msg_id: null,
      sent_at: null,
      send_status: 'pending',
      send_error: null,
    });

    targetsCreated.push({
      id: target.id,
      userid,
      short_code: shortCode,
      copy_used: copyUsed,
      copy_type: copyType,
    });
  }

  // 3. 推送钉钉（按 message_type 分流）
  let sentSuccess = 0;
  let sentFailed = 0;
  const errors: Array<{ userid: string; error: string }> = [];

  for (const t of targetsCreated) {
    try {
      const targetRow = (await listTargetsByTask(env.DB, taskId)).find((x) => x.id === t.id);
      if (!targetRow) continue;

      if (task.message_type === 'work_notification') {
        // 工作通知可以一次推多个 userid（提高效率）
        // 但为了精确定位每个 target 的 msg_id，这里逐个推
        const md = buildPromotionMarkdown({
          title: task.title ?? '推广任务',
          shortUrl: targetRow.short_url!,
          qrUrl: buildQrPublicUrl(env.SHORT_URL_BASE, targetRow.qr_r2_key!),
          originalUrl: task.original_url,
          originalContent: task.original_content ?? '',
          copyFriendCircle: polished.friend_circle,
          copyGroup: polished.group,
          copyPrivate: polished.private,
        });

        const r = await sendWorkNotification(env, [t.userid], {
          title: task.title ?? '推广任务',
          markdown: md,
        });

        if (r.errcode === 0) {
          await updateTarget(env.DB, t.id, {
            send_status: 'success',
            sent_at: Date.now(),
            dingtalk_msg_id: String(r.task_id ?? ''),
          });
          sentSuccess++;
        } else {
          await updateTarget(env.DB, t.id, {
            send_status: 'failed',
            send_error: r.errmsg,
          });
          sentFailed++;
          errors.push({ userid: t.userid, error: r.errmsg });
        }
      } else if (task.message_type === 'todo') {
        const r = await addWorkrecord(env, {
          userid: t.userid,
          title: task.title ?? '推广任务',
          url: targetRow.short_url!,
          formItemList: [
            { title: '推广链接', content: targetRow.short_url ?? '' },
            { title: '原始链接', content: task.original_url },
          ],
          sourceName: 'cf推广统计',
        });
        if (r.errcode === 0) {
          await updateTarget(env.DB, t.id, {
            send_status: 'success',
            sent_at: Date.now(),
            dingtalk_msg_id: r.record_id ?? null,
          });
          sentSuccess++;
        } else {
          await updateTarget(env.DB, t.id, {
            send_status: 'failed',
            send_error: r.errmsg,
          });
          sentFailed++;
          errors.push({ userid: t.userid, error: r.errmsg });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await updateTarget(env.DB, t.id, {
        send_status: 'failed',
        send_error: errMsg,
      });
      sentFailed++;
      errors.push({ userid: t.userid, error: errMsg });
    }
  }

  // 4. 更新任务状态
  await markTaskPublished(env.DB, taskId);

  return {
    task_id: taskId,
    total_promoters: userids.length,
    sent_success: sentSuccess,
    sent_failed: sentFailed,
    errors,
  };
}
