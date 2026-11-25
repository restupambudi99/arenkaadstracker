ALTER TABLE leads ADD COLUMN ctwa_clid TEXT;

CREATE TABLE meta_capi_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  pixel_id TEXT NOT NULL DEFAULT '',
  access_token_cipher TEXT NOT NULL DEFAULT '',
  test_event_code TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR',
  auto_lead INTEGER NOT NULL DEFAULT 0 CHECK(auto_lead IN (0,1)),
  ad_leads_only INTEGER NOT NULL DEFAULT 1 CHECK(ad_leads_only IN (0,1)),
  include_ctwa_clid INTEGER NOT NULL DEFAULT 1 CHECK(include_ctwa_clid IN (0,1)),
  auto_purchase INTEGER NOT NULL DEFAULT 0 CHECK(auto_purchase IN (0,1)),
  consent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE meta_capi_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK(event_name IN ('Lead','Purchase')),
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  response_status INTEGER,
  events_received INTEGER,
  fbtrace_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  UNIQUE(workspace_id,event_id)
);

CREATE INDEX meta_capi_events_workspace_created ON meta_capi_events(workspace_id,created_at DESC);
CREATE INDEX meta_capi_events_workspace_status ON meta_capi_events(workspace_id,status,created_at DESC);
