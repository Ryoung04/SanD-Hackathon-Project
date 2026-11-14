CREATE TABLE IF NOT EXISTS barrier_observations (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  geometry_json JSONB NOT NULL,
  geometry_precision TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_observed_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status TEXT NOT NULL,
  routing_impact TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  min_lon DOUBLE PRECISION NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  max_lon DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_barrier_bbox ON barrier_observations (min_lon, max_lon, min_lat, max_lat);
CREATE INDEX IF NOT EXISTS idx_barrier_source_kind ON barrier_observations (source_kind);
CREATE INDEX IF NOT EXISTS idx_barrier_category ON barrier_observations (category);
