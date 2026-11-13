PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  volume_id TEXT,
  volume_label TEXT,
  removable INTEGER NOT NULL DEFAULT 0 CHECK (removable IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('online', 'offline', 'unknown')),
  last_scan_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(root_path)
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'episode')),
  year INTEGER,
  extension TEXT NOT NULL,
  file_size INTEGER,
  duration_seconds INTEGER,
  exists_on_disk INTEGER NOT NULL DEFAULT 1 CHECK (exists_on_disk IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, relative_path)
);

CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  year INTEGER,
  overview TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL CHECK (season_number >= 0),
  UNIQUE(show_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL UNIQUE REFERENCES media_items(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL CHECK (episode_number > 0),
  title TEXT NOT NULL,
  UNIQUE(season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS artwork (
  id TEXT PRIMARY KEY,
  movie_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
  show_id TEXT REFERENCES shows(id) ON DELETE CASCADE,
  poster_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('local', 'tmdb', 'generated', 'none')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  CHECK ((movie_id IS NULL) != (show_id IS NULL))
);

CREATE TABLE IF NOT EXISTS subtitle_tracks (
  id TEXT PRIMARY KEY,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  relative_path TEXT,
  embedded INTEGER NOT NULL DEFAULT 0 CHECK (embedded IN (0, 1))
);

CREATE TABLE IF NOT EXISTS watch_progress (
  media_item_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  duration_seconds INTEGER,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES media_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'review', 'approved', 'rejected')),
  input_path TEXT NOT NULL,
  suggestion_json TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id);
CREATE INDEX IF NOT EXISTS idx_media_items_kind ON media_items(kind);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_sources_status ON media_sources(status);
