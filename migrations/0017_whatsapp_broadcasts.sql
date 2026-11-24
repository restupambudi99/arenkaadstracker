CREATE TABLE wa_marketing_consents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('opted_in','opted_out')),
  source TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX wa_marketing_consents_latest ON wa_marketing_consents(workspace_id,phone,created_at DESC,id DESC);

CREATE TABLE wa_broadcasts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL,
  body_values TEXT NOT NULL,
  header_values TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','sending','paused','completed')) DEFAULT 'draft',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX wa_broadcasts_workspace ON wa_broadcasts(workspace_id,created_at DESC);

CREATE TABLE wa_broadcast_recipients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  broadcast_id TEXT NOT NULL REFERENCES wa_broadcasts(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','failed','skipped_opt_out')) DEFAULT 'queued',
  error TEXT,
  message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(broadcast_id,phone)
);
CREATE INDEX wa_broadcast_recipients_queue ON wa_broadcast_recipients(workspace_id,broadcast_id,status,created_at);
