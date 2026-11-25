CREATE TABLE offline_tracking_breakdown_files (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES offline_tracking_reports(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension IN ('placement','age','gender')),
  file_name TEXT NOT NULL,
  file_digest TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id,dimension,file_digest)
);

CREATE TABLE offline_tracking_breakdown_rows (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES offline_tracking_breakdown_files(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL REFERENCES offline_tracking_reports(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  day TEXT,
  campaign TEXT,
  dimension_value TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  reach REAL,
  frequency REAL,
  link_clicks REAL,
  results REAL NOT NULL DEFAULT 0,
  video_3s REAL,
  thruplays REAL
);

CREATE INDEX offline_breakdown_report_dimension ON offline_tracking_breakdown_rows(report_id,workspace_id,dimension_value);
CREATE INDEX offline_breakdown_file_rows ON offline_tracking_breakdown_rows(file_id,row_number);
