ALTER TABLE leads ADD COLUMN visitor_id TEXT;
CREATE UNIQUE INDEX leads_workspace_visitor ON leads(workspace_id, visitor_id);
