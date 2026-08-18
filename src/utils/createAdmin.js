/**
 * One-off CLI script to create (or update) an admin user.
 * Usage: node src/utils/createAdmin.js "Abraham Atenaga" you@levyni.com "strongPassword123"
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

async function main() {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error('Usage: node src/utils/createAdmin.js "<name>" "<email>" "<password>"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const normalizedEmail = email.toLowerCase().trim();

  // MySQL has no RETURNING clause, and no native ON CONFLICT — the
  // equivalent is INSERT ... ON DUPLICATE KEY UPDATE against the UNIQUE
  // constraint on `email`. The existing row's id is left untouched.
  await db.query(
    `INSERT INTO admin_users (id, name, email, password_hash)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)`,
    [id, name, normalizedEmail, passwordHash]
  );

  const { rows } = await db.query(
    `SELECT id, name, email FROM admin_users WHERE email = ?`,
    [normalizedEmail]
  );

  console.log('Admin user ready:', rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});