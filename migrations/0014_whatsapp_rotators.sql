CREATE TABLE wa_rotators (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wa_rotator_destinations (
  id TEXT PRIMARY KEY,
  rotator_id TEXT NOT NULL REFERENCES wa_rotators(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  phone TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rotator_id, phone)
);

CREATE TABLE wa_rotator_counters (
  rotator_id TEXT PRIMARY KEY REFERENCES wa_rotators(id) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX wa_rotators_workspace ON wa_rotators(workspace_id, created_at DESC);
CREATE INDEX wa_rotator_destinations_order ON wa_rotator_destinations(rotator_id, position);
