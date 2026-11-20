CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | osm | golfcourseapi
  external_id TEXT,
  holes TEXT NOT NULL,                     -- JSON CourseHole[]
  tees TEXT NOT NULL DEFAULT '[]',         -- JSON CourseTee[]
  unverified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX courses_external ON courses(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX courses_name ON courses(name COLLATE NOCASE);
