ALTER TABLE courses ADD COLUMN lat REAL;
ALTER TABLE courses ADD COLUMN lon REAL;

-- Directory of nearby courses (names and locations only), filled on demand from OpenStreetMap and GolfCourseAPI.
CREATE TABLE course_index (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  lat REAL,
  lon REAL,
  PRIMARY KEY (source, external_id)
);
CREATE INDEX course_index_geo ON course_index(lat, lon);

-- Small key/value cache for area fetches, name searches and geocodes.
CREATE TABLE geo_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
