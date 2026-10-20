CREATE TABLE visit_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO visit_counter (id) VALUES (1);

-- Random opening IDs and hashed undo capabilities; no IPs, agents or schedules.
CREATE TABLE counted_visits (
  id TEXT PRIMARY KEY,
  undo_hash TEXT NOT NULL,
  counted_at INTEGER NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1))
);
CREATE INDEX counted_visits_age ON counted_visits (counted_at);
CREATE TRIGGER count_new_visit AFTER INSERT ON counted_visits WHEN NEW.excluded = 0
BEGIN
  UPDATE visit_counter SET total = total + 1 WHERE id = 1;
END;
CREATE TRIGGER exclude_development_visit AFTER UPDATE OF excluded ON counted_visits
WHEN OLD.excluded = 0 AND NEW.excluded = 1
BEGIN
  UPDATE visit_counter SET total = total - 1 WHERE id = 1;
END;
