/**
 * 任务统计
 */

import type { Env } from '../types.ts';
import {
  countClicksByTask,
  getPromoterRanking,
  listTargetsByTask,
  getUser,
} from '../db/queries.ts';

export async function getTaskStats(env: Env, taskId: string) {
  const [agg, ranking, targets] = await Promise.all([
    countClicksByTask(env.DB, taskId),
    getPromoterRanking(env.DB, taskId),
    listTargetsByTask(env.DB, taskId),
  ]);

  // 给 ranking 补全名字（如果 LEFT JOIN 没补上）
  const enriched = await Promise.all(
    ranking.map(async (r) => {
      if (r.name) return r;
      const u = await getUser(env.DB, r.userid);
      return { ...r, name: u?.name ?? r.userid };
    })
  );

  return {
    summary: {
      total_clicks: agg.total,
      unique_ips: agg.uniqueIps,
      unique_promoters: agg.uniquePromoters,
      total_promoters: targets.length,
    },
    by_device: agg.byDevice,
    by_country: agg.byCountry,
    by_hour: agg.byHour,
    by_browser: agg.byBrowser,
    by_os: agg.byOs,
    by_referer: agg.byReferer,
    promoter_ranking: enriched,
  };
}
