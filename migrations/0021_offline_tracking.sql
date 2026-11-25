CREATE TABLE offline_tracking_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_digest TEXT NOT NULL,
  goal TEXT NOT NULL CHECK(goal IN ('ctwa','lpwa','leads_form','leads_website','sales_website','sales_cpas')),
  currency TEXT NOT NULL DEFAULT 'IDR',
  target_cost_per_result REAL,
  profit_per_sale REAL,
  closing_rate REAL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id,file_digest)
);

CREATE TABLE offline_tracking_rows (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES offline_tracking_reports(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  day TEXT NOT NULL,
  campaign TEXT NOT NULL,
  adset TEXT,
  ad_name TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  reach REAL,
  frequency REAL,
  link_clicks REAL,
  results REAL NOT NULL DEFAULT 0,
  video_3s REAL,
  thruplays REAL,
  objective TEXT,
  delivery TEXT,
  campaign_budget REAL,
  adset_budget REAL,
  quality_ranking TEXT,
  engagement_ranking TEXT,
  conversion_ranking TEXT,
  breakdown_type TEXT,
  breakdown_value TEXT
);

CREATE INDEX offline_rows_report_day ON offline_tracking_rows(report_id,day);
CREATE INDEX offline_rows_workspace_campaign ON offline_tracking_rows(workspace_id,campaign);
