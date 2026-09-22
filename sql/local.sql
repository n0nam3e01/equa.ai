-- Каждый посетитель получает собственное изолированное демонстрационное пространство.
CREATE TABLE IF NOT EXISTS rg_workspaces (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rg_records (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES rg_workspaces(id) ON DELETE CASCADE,
 player_id TEXT NOT NULL, kind TEXT NOT NULL,
 payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rg_records_workspace ON rg_records(workspace_id, player_id, kind);
