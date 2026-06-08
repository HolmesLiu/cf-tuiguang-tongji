/**
 * 任务创建
 * - 由后台 / agent API 调用
 * - 接收润色后的 polished_json（朋友圈/群发/私聊三版）
 */

import { nanoid } from 'nanoid';
import type { Task, MessageType, PolishedCopy, Receivers } from '../types.ts';
import { createTask, getConfig } from '../db/queries.ts';
import { z } from 'zod';
import { fail, ok } from '../utils/json.ts';

export const createTaskSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  original_url: z.string().url(),
  original_content: z.string().max(5000).optional().nullable(),
  receivers: z.object({
    users: z.array(z.string()).default([]),
    departments: z.array(z.number()).default([]),
  }),
  message_type: z.enum(['work_notification', 'todo']).default('work_notification'),
  polished: z
    .object({
      friend_circle: z.string().max(2000),
      group: z.string().max(2000),
      private: z.string().max(2000),
    })
    .optional()
    .nullable(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export interface CreateTaskOptions {
  source: 'agent' | 'dashboard';
  createdBy: string;     // 'agent' 或 admin username
  creatorId: string;     // admin id 或 'agent'
}

/**
 * 创建任务（写 D1，不发布）
 */
export async function createTaskDraft(
  env: D1Database,
  input: CreateTaskInput,
  opts: CreateTaskOptions
): Promise<Task> {
  const cfg = await getConfig(env);
  const messageType: MessageType = input.message_type || (cfg?.default_message_type as MessageType) || 'work_notification';

  const task: Omit<Task, 'created_at' | 'updated_at' | 'published_at' | 'deleted_at'> = {
    id: nanoid(12),
    title: input.title ?? null,
    original_url: input.original_url,
    original_content: input.original_content ?? null,
    receivers_json: JSON.stringify(input.receivers),
    message_type: messageType,
    status: 'draft',
    polished_json: input.polished ? JSON.stringify(input.polished) : null,
    created_by: opts.createdBy,
    creator_id: opts.creatorId,
    source: opts.source,
  };

  return createTask(env, task);
}

/**
 * HTTP handler 包装
 */
export async function handleCreateTask(
  db: D1Database,
  body: unknown,
  opts: CreateTaskOptions
): Promise<Response> {
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', '参数不合法', 400, parsed.error.flatten());
  }
  if (parsed.data.receivers.users.length === 0 && parsed.data.receivers.departments.length === 0) {
    return fail('VALIDATION_ERROR', '接收方不能为空（至少指定一个人或一个部门）', 400);
  }
  if (!parsed.data.polished) {
    return fail('VALIDATION_ERROR', 'polished 文案不能为空（朋友圈/群发/私聊三版）', 400);
  }
  const task = await createTaskDraft(db, parsed.data, opts);
  return ok({ task });
}
