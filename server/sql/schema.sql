-- FileDesk dedicated database schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  name TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Optional starter admin account (change password immediately)
-- INSERT INTO users (username, password, role, name, email)
-- VALUES ('admin', 'admin123', 'admin', 'Administrateur', 'admin@filedesk.local');
