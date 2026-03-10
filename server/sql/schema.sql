-- FileDesk dedicated database schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  name TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_groups_created_by
    FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  CONSTRAINT pk_user_groups PRIMARY KEY (user_id, group_id),
  CONSTRAINT fk_user_groups_user FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_groups_group FOREIGN KEY (group_id)
    REFERENCES groups(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_type TEXT,
  comment TEXT,
  folder_path TEXT DEFAULT 'Racine',
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_uploads_user FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_desks (
  user_id INTEGER PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_file_desks_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

-- Optional starter admin account (change password immediately)
-- INSERT INTO users (username, password, role, name, email)
-- VALUES ('admin', 'admin123', 'admin', 'Administrateur', 'admin@filedesk.local');
