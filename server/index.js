require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function mapRole(rawRole) {
  const normalized = String(rawRole || '').trim().toLowerCase();
  if (normalized === 'görevli' || normalized === 'gorevli') {
    return 'admin';
  }
  return normalized === 'admin' ? 'admin' : 'user';
}

function normalizeUserRow(user) {
  if (!user) {
    return user;
  }

  return {
    ...user,
    role: mapRole(user.role)
  };
}

function normalizeGroupMembers(groupRow) {
  if (!groupRow || !Array.isArray(groupRow.members)) {
    return groupRow;
  }

  return {
    ...groupRow,
    members: groupRow.members.map((member) => {
      if (!member || typeof member !== 'object') {
        return member;
      }
      return {
        ...member,
        role: mapRole(member.role)
      };
    })
  };
}

function isAdminRole(role) {
  return mapRole(role) === 'admin';
}

function getRequesterId(req) {
  const raw = req.get('x-auth-user-id') || req.query.requesterId;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getRequester(req) {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    return null;
  }

  const userResult = await pool.query(
    'SELECT id, username, role, name, email FROM users WHERE id = $1 LIMIT 1',
    [requesterId]
  );

  const requester = userResult.rows[0] || null;
  return normalizeUserRow(requester);
}

async function requireAuth(req, res, next) {
  const requester = await getRequester(req);
  if (!requester) {
    return res.status(401).json({ ok: false, message: 'Authentification requise' });
  }

  req.requester = requester;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.requester || !isAdminRole(req.requester.role)) {
    return res.status(403).json({ ok: false, message: 'Accès réservé à un compte Görevli' });
  }

  next();
}

function ensureInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeDeskPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.nodes || typeof payload.nodes !== 'object') {
    return null;
  }

  const nodes = payload.nodes;
  const root = nodes.root;
  if (!root || root.type !== 'folder') {
    return null;
  }

  if (!Array.isArray(root.children)) {
    root.children = [];
  }

  Object.keys(nodes).forEach((nodeId) => {
    const node = nodes[nodeId];
    if (!node || typeof node !== 'object') {
      delete nodes[nodeId];
      return;
    }

    if (node.type === 'folder' && !Array.isArray(node.children)) {
      node.children = [];
    }

    if (node.type === 'file' && !Array.isArray(node.children)) {
      delete node.children;
    }

    if (!node.id) {
      node.id = nodeId;
    }
  });

  if (!nodes.root) {
    return null;
  }

  return { ...payload, nodes };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: 'Identifiants manquants' });
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

    return res.json({ ok: true, user: normalizeUserRow(result.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.name, u.email,
              COALESCE(
                json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
                FILTER (WHERE g.id IS NOT NULL),
                '[]'::json
              ) AS groups
       FROM users u
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
       WHERE u.id = $1
       GROUP BY u.id
       LIMIT 1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }

    return res.json({ ok: true, user: normalizeUserRow(result.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.name, u.email, u.created_at,
              COALESCE(json_agg(g.name ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL), '[]'::json) AS groups
       FROM users u
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
       GROUP BY u.id
       ORDER BY u.created_at DESC, u.id DESC`
    );

    return res.json({ ok: true, users: result.rows.map(normalizeUserRow) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, name, email } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: 'username et password requis' });
    }

    const mappedRole = mapRole(role || 'user');
    const result = await pool.query(
      `INSERT INTO users (username, password, role, name, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, role, name, email`,
      [username.trim(), password, mappedRole, name || null, email ? email.trim().toLowerCase() : null]
    );

    return res.status(201).json({ ok: true, user: normalizeUserRow(result.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Nom d’utilisateur ou email déjà utilisé' });
    }

    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    const { username, password, role, name, email } = req.body || {};
    const updates = [];
    const values = [];

    if (typeof username === 'string' && username.trim()) {
      values.push(username.trim());
      updates.push(`username = $${values.length}`);
    }

    if (typeof password === 'string' && password.trim()) {
      values.push(password);
      updates.push(`password = $${values.length}`);
    }

    if (typeof role === 'string') {
      values.push(mapRole(role));
      updates.push(`role = $${values.length}`);
    }

    if (typeof name === 'string') {
      values.push(name.trim() || null);
      updates.push(`name = $${values.length}`);
    }

    if (typeof email === 'string') {
      values.push(email.trim().toLowerCase() || null);
      updates.push(`email = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ ok: false, message: 'Aucune donnée à modifier' });
    }

    values.push(id);
    const query = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, username, role, name, email
    `;

    const result = await pool.query(query, values);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, message: 'Utilisateur introuvable' });
    }

    return res.json({ ok: true, user: normalizeUserRow(result.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Nom d’utilisateur ou email déjà utilisé' });
    }

    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    if (id === req.requester.id) {
      return res.status(400).json({ ok: false, message: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ ok: false, message: 'Utilisateur introuvable' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/groups', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.created_at, g.created_by,
              COALESCE(
                json_agg(
                  json_build_object('id', u.id, 'username', u.username, 'name', u.name, 'email', u.email, 'role', u.role)
                  ORDER BY u.username
                ) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS members
       FROM groups g
       LEFT JOIN user_groups ug ON ug.group_id = g.id
       LEFT JOIN users u ON u.id = ug.user_id
       GROUP BY g.id
       ORDER BY g.created_at DESC, g.id DESC`
    );

    const groups = result.rows.map(normalizeGroupMembers);
    return res.json({ ok: true, groups });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.post('/api/groups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, userIds } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, message: 'Nom du groupe requis' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const groupResult = await client.query(
        'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id, name, created_at',
        [String(name).trim(), req.requester.id]
      );
      const group = groupResult.rows[0];

      const ids = Array.isArray(userIds)
        ? userIds.map((id) => ensureInt(id)).filter((id) => id !== null)
        : [];

      if (ids.length) {
        await client.query(
          'INSERT INTO user_groups (group_id, user_id) SELECT $1::int, unnest($2::int[]) ON CONFLICT DO NOTHING',
          [group.id, ids]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ ok: true, group });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, message: 'Ce nom de groupe existe déjà' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.patch('/api/groups/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant groupe invalide' });
    }

    const { name, userIds } = req.body || {};
    if ((typeof name !== 'string' || !name.trim()) && !Array.isArray(userIds)) {
      return res.status(400).json({ ok: false, message: 'Aucune donnée à modifier' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (typeof name === 'string' && name.trim()) {
        await client.query(
          'UPDATE groups SET name=$1 WHERE id=$2',
          [name.trim(), id]
        );
      }

      if (Array.isArray(userIds)) {
        await client.query('DELETE FROM user_groups WHERE group_id = $1', [id]);
        const ids = userIds.map((userId) => ensureInt(userId)).filter((v) => v !== null);
        if (ids.length) {
          await client.query(
            'INSERT INTO user_groups (group_id, user_id) SELECT $1::int, unnest($2::int[]) ON CONFLICT DO NOTHING',
            [id, ids]
          );
        }
      }

      const updated = await client.query(
        `SELECT g.id, g.name, g.created_at, g.created_by,
                COALESCE(
                  json_agg(
                    json_build_object('id', u.id, 'username', u.username, 'name', u.name, 'email', u.email, 'role', u.role)
                    ORDER BY u.username
                  ) FILTER (WHERE u.id IS NOT NULL),
                  '[]'::json
                ) AS members
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         LEFT JOIN users u ON u.id = ug.user_id
         WHERE g.id = $1
         GROUP BY g.id`,
        [id]
      );

      if (!updated.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, message: 'Groupe introuvable' });
      }

      await client.query('COMMIT');
      return res.json({ ok: true, group: normalizeGroupMembers(updated.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, message: 'Ce nom de groupe existe déjà' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.delete('/api/groups/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant groupe invalide' });
    }

    const result = await pool.query('DELETE FROM groups WHERE id = $1', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ ok: false, message: 'Groupe introuvable' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/filedesks/:id', requireAuth, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    const isAdmin = isAdminRole(req.requester.role);
    if (!isAdmin && id !== req.requester.id) {
      return res.status(403).json({ ok: false, message: 'Accès refusé au bureau d’un autre utilisateur' });
    }

    const result = await pool.query(
      'SELECT payload, updated_at FROM file_desks WHERE user_id = $1 LIMIT 1',
      [id]
    );

    return res.json({ ok: true, desk: result.rows[0]?.payload || null, updatedAt: result.rows[0]?.updated_at || null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.put('/api/filedesks/:id', requireAuth, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    const isAdmin = isAdminRole(req.requester.role);
    const payload = req.body?.payload ?? req.body;
    const normalizedDesk = normalizeDeskPayload(payload);
    if (!normalizedDesk) {
      return res.status(400).json({ ok: false, message: 'Données de bureau invalides' });
    }

    if (!isAdmin && id !== req.requester.id) {
      return res.status(403).json({ ok: false, message: 'Modification refusée pour ce compte' });
    }

    await pool.query(
      `INSERT INTO file_desks (user_id, payload, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [id, normalizedDesk]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.post('/api/uploads', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const { entries } = payload;
    const entriesArray = Array.isArray(entries) ? entries : [payload];

    if (!Array.isArray(entriesArray) || !entriesArray.length) {
      return res.status(400).json({ ok: false, message: 'Aucune donnée de dépôt' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entriesArray) {
        const fileName = String(entry?.fileName || '').trim();
        if (!fileName) continue;

        const fileSize = Number(entry?.fileSize) || 0;
        const fileType = entry?.fileType ? String(entry.fileType).trim() : null;
        const folderPath = entry?.folderPath ? String(entry.folderPath) : 'Racine';
        const comment = entry?.comment ? String(entry.comment).trim() : null;

        await client.query(
          `INSERT INTO uploads (user_id, file_name, file_size, file_type, folder_path, comment)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.requester.id, fileName, fileSize, fileType, folderPath, comment]
        );
      }

      await client.query('COMMIT');
      return res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/uploads', requireAuth, async (req, res) => {
  try {
    const requestedUserId = ensureInt(req.query.userId);
    const targetUserId = requestedUserId !== null ? requestedUserId : req.requester.id;

    if (!isAdminRole(req.requester.role) && targetUserId !== req.requester.id) {
      return res.status(403).json({ ok: false, message: 'Accès refusé au dépôt d’un autre utilisateur' });
    }

    const limit = Math.min(200, Math.max(1, ensureInt(req.query.limit) || 50));

    const result = await pool.query(
      `SELECT up.id,
              up.file_name,
              up.file_size,
              up.file_type,
              up.folder_path,
              up.comment,
              to_char(up.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS created_at,
              up.user_id,
              u.username,
              u.name
         FROM uploads up
         JOIN users u ON u.id = up.user_id
        WHERE up.user_id = $1
        ORDER BY up.created_at DESC
        LIMIT $2`,
      [targetUserId, limit]
    );

    return res.json({ ok: true, uploads: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.get('/api/admin/users/:id/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = ensureInt(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide' });
    }

    const userResult = await pool.query(
      `SELECT u.id, u.username, u.role, u.name, u.email,
              fd.payload AS desk,
              COALESCE(json_agg(g.name ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL), '[]'::json) AS groups
       FROM users u
       LEFT JOIN file_desks fd ON fd.user_id = u.id
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
       WHERE u.id = $1
       GROUP BY u.id, fd.payload`,
      [id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ ok: false, message: 'Utilisateur introuvable' });
    }

    const uploads = await pool.query(
      `SELECT up.id,
              up.file_name,
              up.file_size,
              up.file_type,
              up.folder_path,
              up.comment,
              to_char(up.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS created_at
         FROM uploads up
        WHERE up.user_id = $1
        ORDER BY up.created_at DESC
        LIMIT 50`,
      [id]
    );

    const total = await pool.query('SELECT COUNT(*)::int AS count FROM uploads WHERE user_id = $1', [id]);

    return res.json({
      ok: true,
      user: normalizeUserRow(userResult.rows[0]),
      totalUploads: total.rows[0]?.count || 0,
      latestUploads: uploads.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Auth API listening on http://localhost:${PORT}`);
});
