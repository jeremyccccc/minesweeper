import { currentPlayer } from "./_lib/auth.js";
import { database, ensureSchema } from "./_lib/db.js";
import { verifyReplay } from "../rules.js";
import { validGameId } from "./games.js";

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
      const gameId = req.body?.gameId;
      if (!validGameId(gameId)) return res.status(400).json({ error: "成绩必须来自有效对局" });
      const runs = await sql`SELECT level, mine_indices, started_at, completed_at, score_seconds,
          issued_at > NOW() - INTERVAL '24 hours' AS valid
        FROM game_runs WHERE id = ${gameId} AND player_id = ${player.id}`;
      const run = runs[0];
      if (!run || !run.valid || !run.started_at) return res.status(409).json({ error: "对局未开始或已过期，请重开" });
      if (run.completed_at) return res.status(200).json({ ok: true, isRecord: false, seconds: run.score_seconds });
      if (!verifyReplay(run.level, run.mine_indices, req.body?.moves)) {
        return res.status(400).json({ error: "对局校验未通过，未记录成绩" });
      }
      // Claim the run and update both rankings in ONE atomic SQL statement.
      // Time is measured by the server; submitted seconds are never trusted.
      const week = weekKey();
      const rows = await sql`WITH claimed AS (
        UPDATE game_runs SET completed_at = NOW(),
          score_seconds = GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - started_at))))::integer
        WHERE id = ${gameId} AND player_id = ${player.id} AND completed_at IS NULL
          AND started_at IS NOT NULL
        RETURNING player_id, level, score_seconds
      ), previous AS (
        SELECT s.seconds FROM best_scores s
        WHERE s.player_id = ${player.id} AND s.level = ${run.level} AND s.period_key = 'all'
      ), saved AS (
        INSERT INTO best_scores (player_id, level, period_key, seconds)
        SELECT c.player_id, c.level, p.period, c.score_seconds
        FROM claimed c CROSS JOIN (VALUES ('all'), (${week})) AS p(period)
        ON CONFLICT (player_id, level, period_key) DO UPDATE SET
          seconds = LEAST(best_scores.seconds, EXCLUDED.seconds),
          updated_at = CASE WHEN EXCLUDED.seconds < best_scores.seconds THEN NOW() ELSE best_scores.updated_at END
        RETURNING seconds
      ) SELECT c.score_seconds AS seconds,
          NOT EXISTS (SELECT 1 FROM previous WHERE seconds <= c.score_seconds) AS "isRecord"
        FROM claimed c WHERE EXISTS (SELECT 1 FROM saved)`;
      if (!rows.length) return res.status(409).json({ error: "成绩正在处理，请稍后刷新排行榜" });
      return res.status(200).json({ ok: true, isRecord: rows[0].isRecord, seconds: rows[0].seconds });
    }
    return res.status(405).json({ error: "不支持此请求" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: process.env.DATABASE_URL ? "服务器暂时不可用" : "数据库尚未连接" });
  }
}
