CREATE TABLE custom_audiences (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('meta','google')),
  name TEXT NOT NULL,
  criteria TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'not_connected' CHECK(sync_status IN ('not_connected','pending','synced','error')),
  last_export_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, platform, criteria)
);

CREATE INDEX custom_audiences_workspace_updated ON custom_audiences(workspace_id, updated_at DESC);

