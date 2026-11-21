const { Pool, types } = require('pg');

// PostgreSQL sends BIGINT numbers (type 20) as text, like "59997".
// Our amounts are far below JavaScript's safe limit (about 9 quadrillion),
// so we turn them into normal numbers.
types.setTypeParser(20, (value) => Number(value));

// A Pool keeps a few phone lines to the database open,
// so we don't have to redial every time.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

module.exports = pool;