const { Pool } = require("pg");

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
