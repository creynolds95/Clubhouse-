CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL,                    -- r10 | scorecard | other
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE r10_shots (
  id TEXT PRIMARY KEY,
  import_id TEXT,
  session_date TEXT NOT NULL,
  hit_at TEXT,
  club TEXT,
  metrics TEXT NOT NULL,                 -- JSON, normalised units
  dedupe_key TEXT NOT NULL UNIQUE        -- re-importing the same file adds nothing
);
CREATE INDEX r10_shots_date ON r10_shots(session_date DESC);
