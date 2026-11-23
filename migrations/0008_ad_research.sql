CREATE TABLE ad_research_competitors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_ref TEXT,
  search_terms TEXT,
  country TEXT NOT NULL DEFAULT 'ID',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ad_research_competitors_workspace ON ad_research_competitors(workspace_id, created_at DESC);

CREATE TABLE ad_research_swipe_ads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ad_url TEXT,
  competitor_id TEXT REFERENCES ad_research_competitors(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'Video' CHECK(format IN ('Video','Gambar','Carousel','Lainnya')),
  body TEXT,
  note TEXT,
  tags TEXT NOT NULL DEFAULT '',
  first_seen_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ad_research_swipe_workspace_recent ON ad_research_swipe_ads(workspace_id, first_seen_date DESC, created_at DESC);
CREATE INDEX ad_research_swipe_competitor ON ad_research_swipe_ads(workspace_id, competitor_id);

