-- SQLite-схема для localhost. JSON хранится текстом, запросы параметризованы.
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    transaction_data TEXT NOT NULL,
    policy_data TEXT NOT NULL,
    result_data TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('approve', 'challenge', 'block')),
    challenge_outcome TEXT CHECK (challenge_outcome IN ('passed', 'failed'))
);
CREATE INDEX IF NOT EXISTS decisions_created_at_idx ON decisions(created_at DESC);
