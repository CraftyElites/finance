const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Thin wrapper so route code can keep using the same shape it would with
// node-postgres: `const { rows } = await db.query(sql, params)`.
async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return { rows };
}

// Mimics pg's `pool.connect()` -> client with `.query()` / `.release()`,
// so routes that run multi-statement transactions (BEGIN/COMMIT/ROLLBACK,
// SELECT ... FOR UPDATE) don't need to change their control flow.
async function connect() {
  const conn = await pool.getConnection();
  return {
    query: async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return { rows };
    },
    release: () => conn.release(),
  };
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle MySQL connection', err);
});

module.exports = {
  query,
  pool: {
    connect,
    query,
    end: () => pool.end(),
  },
};