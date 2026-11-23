CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret_cipher TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inbound_webhooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  response_status INTEGER,
  success INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);

CREATE TABLE inbound_webhook_requests (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES inbound_webhooks(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(webhook_id, external_id)
);

CREATE TABLE inbound_webhook_limits (
  webhook_id TEXT PRIMARY KEY REFERENCES inbound_webhooks(id) ON DELETE CASCADE,
  window_bucket INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX webhook_endpoints_workspace ON webhook_endpoints(workspace_id, created_at DESC);
CREATE INDEX webhook_deliveries_workspace ON webhook_deliveries(workspace_id, created_at DESC);
CREATE INDEX inbound_webhooks_workspace ON inbound_webhooks(workspace_id, created_at DESC);

