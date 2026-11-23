CREATE TABLE custom_domains (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, hostname)
);

CREATE INDEX custom_domains_workspace ON custom_domains(workspace_id, created_at DESC);
