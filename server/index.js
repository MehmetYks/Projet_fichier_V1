require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Same login principle as calendrier-ditib-v1-test
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: 'Missing credentials' });
    }

    const cleaned = String(username).trim();
    const result = await pool.query(
      `SELECT id, username, role, name, email
       FROM users
       WHERE (username=$1 OR LOWER(email)=LOWER($1)) AND password=$2
       LIMIT 1`,
      [cleaned, password]
    );

    if (!result.rows.length) {
      return res.status(401).json({ ok: false, message: 'Login incorrect' });
    }

    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, username, role, name, email
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Auth API listening on http://localhost:${PORT}`);
});
