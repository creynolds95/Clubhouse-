CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- API requests per UTC day (the free Workers limit resets at 00:00 UTC). Static files are free and not counted.
CREATE TABLE usage_daily (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0
);
