import { createSession, currentPlayer, destroySession, hashPassword, validPassword, validUsername, verifyPassword } from "./_lib/auth.js";
import { database, ensureSchema } from "./_lib/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === "GET") {
      const player = await currentPlayer(req);
      return res.status(200).json({ user: player ? { username: player.username } : null });
    }
    if (req.method === "DELETE") {
      await destroySession(req, res);
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "不支持此请求" });

    const username = validUsername(req.body?.username);
    const password = req.body?.password;
    const action = req.body?.action;
    if (!username || !validPassword(password)) return res.status(400).json({ error: "昵称需为 1–16 个字符，密码至少 6 位" });
    const key = username.toLocaleLowerCase("zh-CN");
    const sql = database();

    if (action === "register") {
      const existing = await sql`SELECT id FROM players WHERE username_key = ${key}`;
      if (existing.length) return res.status(409).json({ error: "该昵称已被注册" });
      const passwordHash = await hashPassword(password);
      const rows = await sql`INSERT INTO players (username, username_key, password_hash) VALUES (${username}, ${key}, ${passwordHash}) RETURNING id, username`;
      await createSession(rows[0].id, res);
      return res.status(201).json({ user: { username: rows[0].username } });
    }

    const rows = await sql`SELECT id, username, password_hash FROM players WHERE username_key = ${key}`;
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) return res.status(401).json({ error: "昵称或密码不正确" });
    await createSession(rows[0].id, res);
    return res.status(200).json({ user: { username: rows[0].username } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: process.env.DATABASE_URL ? "服务器暂时不可用" : "数据库尚未连接" });
  }
}
