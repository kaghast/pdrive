import { getSqlConnectionConfig, pool } from './index.ts';
import { DEFAULT_DASHBOARD_LAYOUT, DEFAULT_OPEN_WITH } from './schema.ts';

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" serial PRIMARY KEY NOT NULL,
    "uid" text NOT NULL UNIQUE,
    "email" text NOT NULL,
    "display_name" text,
    "photo_url" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "user_settings" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
    "theme" text DEFAULT 'light' NOT NULL,
    "default_view_mode" text DEFAULT 'grid' NOT NULL,
    "default_open_with" jsonb DEFAULT '${JSON.stringify(DEFAULT_OPEN_WITH)}'::jsonb NOT NULL,
    "dashboard_layout" jsonb DEFAULT '${JSON.stringify(DEFAULT_DASHBOARD_LAYOUT)}'::jsonb NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "connected_accounts" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "account_email" text,
    "account_name" text,
    "access_token_enc" text NOT NULL,
    "refresh_token_enc" text,
    "expires_at" timestamp,
    "scopes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "connected_accounts_user_provider_idx"
    ON "connected_accounts" ("user_id", "provider");`,

  `CREATE TABLE IF NOT EXISTS "file_metadata" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text DEFAULT 'google-drive' NOT NULL,
    "file_id" text NOT NULL,
    "file_name" text NOT NULL,
    "mime_type" text NOT NULL,
    "parent_id" text,
    "size_bytes" text,
    "is_favorite" boolean DEFAULT false NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "last_opened_at" timestamp,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "file_metadata_user_provider_file_idx"
    ON "file_metadata" ("user_id", "provider", "file_id");`,

  `CREATE TABLE IF NOT EXISTS "editing_sessions" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "drive_file_id" text NOT NULL,
    "drive_file_name" text NOT NULL,
    "drive_mime_type" text NOT NULL,
    "is_google_doc" boolean DEFAULT false NOT NULL,
    "original_drive_modified_time" text,
    "original_drive_md5" text,
    "original_drive_size" text,
    "onedrive_item_id" text,
    "onedrive_web_url" text,
    "onedrive_original_etag" text,
    "onedrive_temp_path" text,
    "status" text DEFAULT 'creating' NOT NULL,
    "sync_attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "last_verified_size" text,
    "last_verified_modified_time" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "expires_at" timestamp NOT NULL,
    "completed_at" timestamp
  );`,

  `CREATE TABLE IF NOT EXISTS "background_jobs" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "job_type" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "summary" text NOT NULL,
    "result_meta" jsonb,
    "error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
    "action" text NOT NULL,
    "target_type" text NOT NULL,
    "target_id" text,
    "target_name" text,
    "status" text NOT NULL,
    "details" jsonb,
    "ip_address" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );`,
];

/**
 * Idempotently ensures all PostgreSQL tables and indexes exist on startup.
 * Safe to run on every redeploy: uses CREATE ... IF NOT EXISTS and never drops/truncates existing data.
 */
export async function ensureDatabaseSchema(maxAttempts = 6, delayMs = 2000): Promise<void> {
  const cfg = getSqlConnectionConfig();
  if (!cfg.host || !cfg.database) {
    console.warn('[DB] SQL_HOST or SQL_DB_NAME is not set; skipping automatic schema bootstrap.');
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      try {
        for (const stmt of SCHEMA_STATEMENTS) {
          await client.query(stmt);
        }
        console.log('[DB] PostgreSQL schema verified (persistent tables ready).');
        return;
      } finally {
        client.release();
      }
    } catch (err) {
      lastError = err;
      console.warn(
        `[DB] Waiting for PostgreSQL (attempt ${attempt}/${maxAttempts}):`,
        err instanceof Error ? err.message : err
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  console.error('[DB] Failed to verify PostgreSQL schema after retries:', lastError);
}
