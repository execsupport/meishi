CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'follow', 'done', 'archived')),
  prev_status TEXT CHECK (prev_status IS NULL OR prev_status IN ('inbox', 'follow', 'done')),
  name TEXT NOT NULL DEFAULT '',
  name_kana TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX idx_cards_user_status ON cards(user_id, status, position);
