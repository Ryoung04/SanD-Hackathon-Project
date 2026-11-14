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
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE barrier_observations ADD COLUMN IF NOT EXISTS geom geometry(Geometry,4326);
CREATE INDEX IF NOT EXISTS idx_barrier_geom ON barrier_observations USING GIST (geom);
UPDATE barrier_observations SET geom = ST_SetSRID(ST_GeomFromGeoJSON(geometry_json::text),4326) WHERE geom IS NULL;
CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGSERIAL PRIMARY KEY,
  source_kind TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  fetched INT,
  normalized INT,
  rejected INT,
  inserted INT,
  updated INT,
  marked_outdated INT,
  error TEXT,
  neon_branch TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_kind ON ingest_runs (source_kind, started_at DESC);
