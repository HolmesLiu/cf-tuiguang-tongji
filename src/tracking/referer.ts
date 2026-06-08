/**
 * Referer 归一
 * 提取 host 作为渠道标识
 */

export function normalizeReferer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return u.host || null;
  } catch {
    // 不是合法 URL，原样返回（去掉长度限制）
    return referer.length > 200 ? referer.slice(0, 200) : referer;
  }
}
