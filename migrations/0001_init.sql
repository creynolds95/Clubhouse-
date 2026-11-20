CREATE TABLE swings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  taken_at TEXT,
  club TEXT,
  view TEXT,
  note TEXT,
  video_key TEXT,
  frames TEXT NOT NULL DEFAULT '[]',     -- JSON array of phases with a stored keyframe
  metrics TEXT,                          -- JSON SwingMetrics
  feedback TEXT,
  r10_shot_id TEXT
);
CREATE INDEX swings_created ON swings(created_at DESC);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  played_on TEXT NOT NULL,
  course TEXT NOT NULL,
  tees TEXT,
  holes TEXT NOT NULL,                   -- JSON HoleScore[]
  total INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT UNIQUE                -- Garmin scorecard id, for idempotent imports
);
CREATE INDEX rounds_played ON rounds(played_on DESC);

CREATE TABLE practice_plans (
  id TEXT PRIMARY KEY,
  week_of TEXT NOT NULL,
  plan TEXT NOT NULL,                    -- JSON
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
