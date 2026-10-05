-- Initial Lucrum D1 foundation.
-- Domain tables are added in follow-up migrations as repositories move behind
-- the runtime-neutral adapter boundary.

CREATE TABLE IF NOT EXISTS _lucrum_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worker_health (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  service TEXT NOT NULL DEFAULT 'lucrum-api',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO worker_health (id) VALUES (1);
