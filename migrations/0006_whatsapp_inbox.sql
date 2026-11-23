CREATE TABLE wa_connections (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL UNIQUE,
  waba_id TEXT NOT NULL,
  access_token_cipher TEXT NOT NULL,
  app_secret_cipher TEXT NOT NULL,
  verify_token_hash TEXT NOT NULL,
  api_version TEXT NOT NULL DEFAULT 'v27.0',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wa_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  last_message_at TEXT,
  last_read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, wa_id)
);

CREATE TABLE wa_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  message_type TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX wa_conversations_workspace_recent ON wa_conversations(workspace_id, status, last_message_at DESC);
CREATE INDEX wa_messages_conversation_recent ON wa_messages(conversation_id, sent_at DESC);

