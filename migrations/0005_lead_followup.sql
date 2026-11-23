ALTER TABLE leads ADD COLUMN follow_up_at TEXT;
ALTER TABLE leads ADD COLUMN follow_up_note TEXT;
CREATE INDEX leads_workspace_followup ON leads(workspace_id, follow_up_at);
