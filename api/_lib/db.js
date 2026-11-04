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
        CONSTRAINT best_scores_nonnegative_seconds CHECK (seconds >= 0)
      )`;
      // Remove the old 999-second limit without touching existing scores.
      await sql`ALTER TABLE best_scores DROP CONSTRAINT IF EXISTS best_scores_seconds_check`;
      await sql`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'best_scores_nonnegative_seconds' AND conrelid = 'best_scores'::regclass) THEN
          ALTER TABLE best_scores ADD CONSTRAINT best_scores_nonnegative_seconds CHECK (seconds >= 0);
        END IF;
      END $$`;
      await sql`CREATE TABLE IF NOT EXISTS game_runs (
        id UUID PRIMARY KEY,
        player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        level VARCHAR(10) NOT NULL CHECK (level IN ('easy', 'medium', 'hard')),
        mine_indices JSONB NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        score_seconds INTEGER CHECK (score_seconds >= 0)
      )`;
    })().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}
