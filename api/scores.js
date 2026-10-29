import { currentPlayer } from "./_lib/auth.js";
import { database, ensureSchema } from "./_lib/db.js";

const LEVELS = new Set(["easy", "medium", "hard"]);

function weekKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const sql = database();
    if (req.method === "GET") {
      const level = String(req.query.level || "easy");
      const range = req.query.range === "history" ? "history" : "week";
      if (!LEVELS.has(level)) return res.status(400).json({ error: "无效难度" });
      const period = range === "history" ? "all" : weekKey();
      const rows = await sql`SELECT p.username, s.seconds FROM best_scores s JOIN players p ON p.id = s.player_id WHERE s.level = ${level} AND s.period_key = ${period} ORDER BY s.seconds ASC, s.updated_at ASC LIMIT 20`;
      return res.status(200).json({ scores: rows.map(row => ({ username: row.username, seconds: row.seconds })) });
    }

    if (req.method === "POST") {
      const player = await currentPlayer(req);
      if (!player) return res.status(401).json({ error: "请先登录" });
      const level = String(req.body?.level || "");
      const seconds = Number(req.body?.seconds);
      if (!LEVELS.has(level) || !Number.isInteger(seconds) || seconds < 0 || seconds > 999) return res.status(400).json({ error: "成绩无效" });
      const previous = await sql`SELECT seconds FROM best_scores WHERE player_id = ${player.id} AND level = ${level} AND period_key = 'all'`;
      const isRecord = !previous[0] || seconds < previous[0].seconds;
      await sql`INSERT INTO best_scores (player_id, level, period_key, seconds) VALUES (${player.id}, ${level}, 'all', ${seconds}) ON CONFLICT (player_id, level, period_key) DO UPDATE SET seconds = LEAST(best_scores.seconds, EXCLUDED.seconds), updated_at = CASE WHEN EXCLUDED.seconds < best_scores.seconds THEN NOW() ELSE best_scores.updated_at END`;
      const week = weekKey();
      await sql`INSERT INTO best_scores (player_id, level, period_key, seconds) VALUES (${player.id}, ${level}, ${week}, ${seconds}) ON CONFLICT (player_id, level, period_key) DO UPDATE SET seconds = LEAST(best_scores.seconds, EXCLUDED.seconds), updated_at = CASE WHEN EXCLUDED.seconds < best_scores.seconds THEN NOW() ELSE best_scores.updated_at END`;
      return res.status(200).json({ ok: true, isRecord });
    }
    return res.status(405).json({ error: "不支持此请求" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: process.env.DATABASE_URL ? "服务器暂时不可用" : "数据库尚未连接" });
  }
}
