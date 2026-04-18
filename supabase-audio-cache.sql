-- DreamListenBar Audio Cache Table
-- Run this in Supabase SQL Editor

-- Create audio_cache table
CREATE TABLE IF NOT EXISTS audio_cache (
  id BIGSERIAL PRIMARY KEY,
  tingId UUID UNIQUE NOT NULL,
  title TEXT,
  tingNo INTEGER,
  audioUrl TEXT NOT NULL,
  source TEXT DEFAULT 'indexed',
  indexedAt TIMESTAMPTZ DEFAULT NOW(),
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_audio_cache_ting_id ON audio_cache(tingId);
CREATE INDEX IF NOT EXISTS idx_audio_cache_indexed_at ON audio_cache(indexedAt);

-- Enable RLS (Row Level Security)
ALTER TABLE audio_cache ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read access
CREATE POLICY "Allow anonymous read" ON audio_cache
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous insert/update (for indexer)
CREATE POLICY "Allow anonymous write" ON audio_cache
  FOR ALL
  TO anon
  WITH CHECK (true);

-- Create update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updatedAt = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_audio_cache_updated_at
  BEFORE UPDATE ON audio_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
