import { neon } from "@neondatabase/serverless";

let schemaReady;

export function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export function ensureSchema() {
  if (!schemaReady) {
    const sql = database();
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS players (
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(16) NOT NULL,
        username_key VARCHAR(32) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS best_scores (
        player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        level VARCHAR(10) NOT NULL,
        period_key VARCHAR(16) NOT NULL,
        seconds INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (player_id, level, period_key),
        CHECK (level IN ('easy', 'medium', 'hard')),
        CHECK (seconds BETWEEN 0 AND 999)
      )`;
    })().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}
