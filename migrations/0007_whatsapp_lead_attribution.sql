ALTER TABLE wa_conversations
  ADD COLUMN lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX wa_conversations_lead ON wa_conversations(workspace_id, lead_id);

