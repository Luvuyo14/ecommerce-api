const express = require('express');
const pool = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const productRoutes = require('./routes/products.routes');

const app = express();

// Lets the server understand JSON sent to it
app.use(express.json());

// Health check: "Are you alive? Can you reach the database?"
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS time');
    res.json({
      status: 'ok',
      message: 'The server is alive and the database answered!',
      databaseTime: result.rows[0].time,
    });
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'The server is alive, but the database is not reachable.',
    });
  }
});

// Everything in auth.routes.js starts with /auth
app.use('/auth', authRoutes);

// Everything in admin.routes.js starts with /admin (admins only)
app.use('/admin', adminRoutes);

// Everything in products.routes.js starts with /products (public)
app.use('/products', productRoutes);

// Safety net 1: no route matched, so answer with JSON instead of an HTML page
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// Safety net 2: something threw an error and nobody caught it.
// (Express knows this is an error handler because it has FOUR inputs.)
app.use((err, req, res, next) => {
  // Broken JSON in the request body, for example a missing quote
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'The request body is not valid JSON.' });
  }

  console.error('Unexpected error:', err.message);
  res
    .status(500)
    .json({ message: 'Something went wrong. Please try again later.' });
});

module.exports = app;