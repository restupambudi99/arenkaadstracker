-- Additive CSPoint data. Existing tracking, auth and Cloud API tables are untouched.
CREATE TABLE cs_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('products','orders','contacts','templates','knowledge')),
  name TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cs_records_workspace_kind ON cs_records(workspace_id,kind,created_at DESC);
CREATE TABLE cs_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  router_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'Hermesollama',
  api_key_cipher TEXT NOT NULL DEFAULT '',
  gateway_url TEXT NOT NULL DEFAULT '',
  gateway_token_cipher TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX cs_gateway_single_workspace ON cs_settings(gateway_url) WHERE gateway_url<>'';
CREATE TABLE cs_agents (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  instance TEXT NOT NULL,
  assistant_name TEXT NOT NULL DEFAULT 'Kak',
  instructions TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,instance)
);
