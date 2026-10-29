import crypto from "node:crypto";
import { promisify } from "node:util";
import { database, ensureSchema } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const COOKIE = "mine_session";
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hex] = String(stored).split(":");
  if (!salt || !hex) return false;
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function digest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieValue(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
  return cookies[COOKIE] || "";
}

export async function createSession(playerId, res) {
  const sql = database();
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await sql`INSERT INTO sessions (token_hash, player_id, expires_at) VALUES (${digest(token)}, ${playerId}, ${expires})`;
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}

export async function currentPlayer(req) {
  await ensureSchema();
  const token = cookieValue(req);
  if (!token) return null;
  const sql = database();
  const rows = await sql`SELECT p.id, p.username FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ${digest(token)} AND s.expires_at > NOW()`;
  return rows[0] || null;
}

export async function destroySession(req, res) {
  const token = cookieValue(req);
  if (token) {
    const sql = database();
    await sql`DELETE FROM sessions WHERE token_hash = ${digest(token)}`;
  }
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function validUsername(value) {
  const username = String(value || "").trim().replace(/\s+/g, " ");
  return username.length >= 1 && username.length <= 16 ? username : "";
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 6 && value.length <= 72;
}
