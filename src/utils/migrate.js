require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function migrate() {
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  // multipleStatements is only enabled on this one-off connection, since a
  // migration file may contain several CREATE TABLE statements separated
  // by semicolons.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    try {
      await connection.query(sql);
    } catch (err) {
      // Re-running a migration is safe for CREATE TABLE IF NOT EXISTS, but a
      // named index/constraint can still collide on a second run — treat
      // "already exists" errors as non-fatal so `npm run migrate` stays
      // idempotent.
      if (
        err.code === 'ER_DUP_KEYNAME' ||
        err.code === 'ER_DUP_ENTRY' ||
        err.code === 'ER_FK_DUP_NAME' ||
        err.code === 'ER_DUP_FIELDNAME'
      ) {
        console.warn(`  (skipped, already applied) ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  console.log('Migrations complete.');
  await connection.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});