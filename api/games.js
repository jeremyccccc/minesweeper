import { randomInt, randomUUID } from "node:crypto";
import { currentPlayer } from "./_lib/auth.js";
import { database, ensureSchema } from "./_lib/db.js";
import { createGame, LEVELS } from "../rules.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "不支持此请求" });
  try {
    await ensureSchema();
    const player = await currentPlayer(req);
    if (!player) return res.status(401).json({ error: "请先登录" });
    const sql = database();
    if (req.body?.action === "new") {
      const level = req.body.level;
      if (typeof level !== "string" || !Object.hasOwn(LEVELS, level)) return res.status(400).json({ error: "无效难度" });
      const game = createGame(level, undefined, () => randomInt(0x100000000) / 0x100000000);
      const mines = game.flat.filter(cell => cell.mine).map(cell => cell.index);
      const gameId = randomUUID();
      await sql`INSERT INTO game_runs (id, player_id, level, mine_indices)
        VALUES (${gameId}, ${player.id}, ${level}, ${JSON.stringify(mines)}::jsonb)`;
      return res.status(201).json({ gameId, mines });
    }
    if (req.body?.action === "start") {
      const gameId = req.body.gameId;
      if (!validGameId(gameId)) return res.status(400).json({ error: "无效对局" });
      const rows = await sql`UPDATE game_runs SET started_at = COALESCE(started_at, NOW())
        WHERE id = ${gameId} AND player_id = ${player.id} AND completed_at IS NULL
          AND issued_at > NOW() - INTERVAL '24 hours'
        RETURNING id`;
      if (!rows.length) return res.status(409).json({ error: "对局已结束或已过期，请重开" });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "无效操作" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "无法连接排名服务，请稍后重试" });
  }
}

export function validGameId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
