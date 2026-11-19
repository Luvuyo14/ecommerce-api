const pool = require('../config/db');

const DEFAULT_LIMIT = 10; // products per page if the customer doesn't say
const MAX_LIMIT = 50;     // never send more than this in one go
const MAX_ID = 2147483647; // the biggest number PostgreSQL's SERIAL can hold

// Turns "2" into 2. If it's missing, not a number or below 1, use the fallback.
function parsePositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

// GET /products?search=mouse&page=1&limit=10
async function listProducts(req, res) {
  try {
    // 1. Read the options from the web address (the "query string")
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit; // how many products to skip

    // 2. Build the search pattern.
    //    In SQL, % means "anything" and _ means "any one letter".
    //    We put a backslash before those characters, so a customer typing "50%"
    //    searches for the text "50%" and doesn't match everything.
    const escaped = search.replace(/[\\%_]/g, '\\$&');
    const pattern = search ? `%${escaped}%` : '%'; // '%' matches every product

    // 3. Count how many products match (so the shop can show "page 1 of 3")
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM products
       WHERE is_active = TRUE
         AND (name ILIKE $1 OR description ILIKE $1)`,
      [pattern]
    );
    const total = countResult.rows[0].total;

    // 4. Get just this page of products.
    //    ILIKE = "like", but ignoring capital letters.
    const result = await pool.query(
      `SELECT id, name, description, price_cents, stock
       FROM products
       WHERE is_active = TRUE
         AND (name ILIKE $1 OR description ILIKE $1)
       ORDER BY id
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );

    return res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List products error:', error.message);
    return res
      .status(500)
      .json({ message: 'Something went wrong. Please try again later.' });
  }
}

// GET /products/:id
async function getProduct(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1 || id > MAX_ID) {
      return res.status(400).json({ message: 'Product id must be a positive whole number.' });
    }

    const result = await pool.query(
      `SELECT id, name, description, price_cents, stock
       FROM products
       WHERE id = $1 AND is_active = TRUE`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get product error:', error.message);
    return res
      .status(500)
      .json({ message: 'Something went wrong. Please try again later.' });
  }
}

module.exports = { listProducts, getProduct };