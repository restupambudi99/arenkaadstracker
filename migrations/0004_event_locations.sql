ALTER TABLE events ADD COLUMN country TEXT;
ALTER TABLE events ADD COLUMN region TEXT;
ALTER TABLE events ADD COLUMN city TEXT;
CREATE INDEX events_workspace_region_created ON events(workspace_id, region, created_at DESC);
