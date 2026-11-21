-- R10 shots look up their tagged swing on every list; without this each shot scanned the whole swings table.
CREATE INDEX IF NOT EXISTS swings_r10 ON swings(r10_shot_id);

-- One row per outbound call (or skipped/cached call) to an outside service. No URLs, headers or keys are stored.
CREATE TABLE api_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL,        -- golfcourseapi | opengolf | nominatim | overpass | zippopotam | anthropic
  purpose TEXT NOT NULL,       -- what the call was for, e.g. "search: pecan hollow"
  outcome TEXT NOT NULL,       -- ok | error | cached | skipped
  status INTEGER,              -- HTTP status, 0 = timeout or network error, NULL when no call was made
  ms INTEGER,
  quota_left INTEGER,          -- GolfCourseAPI budget left after this call
  note TEXT
);
CREATE INDEX api_log_at ON api_log(at DESC);
CREATE INDEX api_log_source ON api_log(source, at);
