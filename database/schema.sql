PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  root_relative_path TEXT,
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
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'episode', 'collection', 'other')),
  classification_status TEXT NOT NULL DEFAULT 'review'
    CHECK (classification_status IN ('auto', 'review', 'approved', 'ignored')),
  classification_reason TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  deleted_at TEXT,
  year INTEGER,
  overview TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
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
  overview TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS media_item_title_history (
  id TEXT PRIMARY KEY,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  old_title TEXT NOT NULL,
  new_title TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_key TEXT NOT NULL,
  is_kids INTEGER NOT NULL DEFAULT 0 CHECK (is_kids IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  artwork_type TEXT NOT NULL DEFAULT 'poster'
    CHECK (artwork_type IN ('poster', 'banner')),
  remote_url TEXT,
  local_path TEXT,
  provider TEXT,
  provider_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('local', 'tmdb', 'generated', 'none')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  CHECK ((movie_id IS NULL) != (show_id IS NULL))
);

CREATE TABLE IF NOT EXISTS subtitle_tracks (
  id TEXT PRIMARY KEY,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual'
    CHECK (provider IN ('embedded', 'opensubtitles', 'manual', 'none')),
  remote_id TEXT,
  remote_url TEXT,
  relative_path TEXT,
  embedded INTEGER NOT NULL DEFAULT 0 CHECK (embedded IN (0, 1)),
  hearing_impaired INTEGER NOT NULL DEFAULT 0 CHECK (hearing_impaired IN (0, 1))
);

CREATE TABLE IF NOT EXISTS watch_progress (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  duration_seconds INTEGER,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, media_item_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_item_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
  show_id TEXT REFERENCES shows(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  review TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((media_item_id IS NULL) != (show_id IS NULL)),
  UNIQUE(profile_id, media_item_id),
  UNIQUE(profile_id, show_id)
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
