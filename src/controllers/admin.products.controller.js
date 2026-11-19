const pool = require('../config/db');

const DEFAULT_LIMIT = 10;          // products per page if the admin doesn't say
const MAX_LIMIT = 50;              // never send more than this in one go
const MAX_ID = 2147483647;         // the biggest number PostgreSQL's SERIAL can hold
const MAX_PRICE_CENTS = 100000000; // 1,000,000.00: a sensible upper limit
const MAX_STOCK = 1000000;         // a sensible upper limit for stock

// The columns we send back for a product (admins also see the hidden switch and dates)
const COLUMNS =
  'id, name, description, price_cents, stock, is_active, created_at, updated_at';

// ---------- small helpers ----------

// Turns "2" into 2. If it's missing, not a number or below 1, use the fallback.
function parsePositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

// Turns the :id from the web address into a safe number, or null if it is not valid.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

// Each checker returns an error message, or null when the value is fine.
function checkName(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
    return 'Name must be text between 1 and 200 characters.';
  }
  return null;
}

function checkDescription(value) {
  if (typeof value !== 'string' || value.length > 5000) {
    return 'Description must be text of 5000 characters or fewer.';
  }
  return null;
}

function checkPrice(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    return `price_cents must be a whole number from 0 to ${MAX_PRICE_CENTS} (24999 means 249.99).`;
  }
  return null;
}

function checkStock(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_STOCK) {
    return `stock must be a whole number from 0 to ${MAX_STOCK}.`;
  }
  return null;
}

function checkActive(value) {
  if (typeof value !== 'boolean') {
    return 'is_active must be true or false.';
  }
  return null;
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res
    .status(500)
    .json({ message: 'Something went wrong. Please try again later.' });
}

// ---------- the doors ----------

// GET /admin/products?page=1&limit=10  → every product, hidden ones too
async function listAllProducts(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM products');
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT ${COLUMNS} FROM products ORDER BY id LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      data: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return serverError(res, 'Admin list products error', error);
  }
}

// POST /admin/products  → add a new product
async function createProduct(req, res) {
  try {
    const {
      name,
      description = '',
      price_cents,
      stock = 0,
      is_active = true,
    } = req.body ?? {};

    // Check everything. The first problem we find is reported.
    const problem =
      checkName(name) ||
      checkDescription(description) ||
      checkPrice(price_cents) ||
      checkStock(stock) ||
      checkActive(is_active);

    if (problem) {
      return res.status(400).json({ message: problem });
    }

    const result = await pool.query(
      `INSERT INTO products (name, description, price_cents, stock, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [name.trim(), description, price_cents, stock, is_active]
    );

    return res.status(201).json({
      message: 'Product created.',
      data: result.rows[0],
    });
  } catch (error) {
    return serverError(res, 'Create product error', error);
  }
}

// PATCH /admin/products/:id  → change some details of a product
async function updateProduct(req, res) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: 'Product id must be a positive whole number.' });
    }

    const body = req.body ?? {};

    // The checkers for each field we allow to be changed here.
    // (Stock is NOT in this list: it has its own door.)
    const allowed = {
      name: checkName,
      description: checkDescription,
      price_cents: checkPrice,
      is_active: checkActive,
    };

    // Refuse any field we don't know, so nothing unexpected gets through.
    const unknown = Object.keys(body).filter((key) => !(key in allowed));
    if (unknown.length > 0) {
      return res.status(400).json({
        message:
          `You cannot change: ${unknown.join(', ')}. ` +
          `Allowed fields: ${Object.keys(allowed).join(', ')}. ` +
          'To change stock use PATCH /admin/products/:id/stock.',
      });
    }

    // Build the "SET ..." part from only the fields that were sent.
    // The column names come from OUR list above, never from the request,
    // so this is safe. The values go in through $1, $2... as usual.
    const setParts = [];
    const values = [];

    for (const [column, check] of Object.entries(allowed)) {
      if (body[column] === undefined) continue; // not sent, leave it alone

      const problem = check(body[column]);
      if (problem) {
        return res.status(400).json({ message: problem });
      }

      values.push(column === 'name' ? body.name.trim() : body[column]);
      setParts.push(`${column} = $${values.length}`);
    }

    if (setParts.length === 0) {
      return res.status(400).json({ message: 'Send at least one field to change.' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE products
       SET ${setParts.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${COLUMNS}`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({ message: 'Product updated.', data: result.rows[0] });
  } catch (error) {
    return serverError(res, 'Update product error', error);
  }
}

// PATCH /admin/products/:id/stock
//   {"stock": 50}   → set the stock to exactly 50
//   {"change": -5}  → remove 5 (or {"change": 10} to add 10)
async function updateStock(req, res) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: 'Product id must be a positive whole number.' });
    }

    const body = req.body ?? {};
    const hasStock = body.stock !== undefined;
    const hasChange = body.change !== undefined;

    // Exactly one of the two must be sent.
    if (hasStock === hasChange) {
      return res.status(400).json({
        message:
          'Send either "stock" (set an exact number) or "change" (add or remove), not both and not neither.',
      });
    }

    let result;

    if (hasStock) {
      const problem = checkStock(body.stock);
      if (problem) {
        return res.status(400).json({ message: problem });
      }

      result = await pool.query(
        `UPDATE products SET stock = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING ${COLUMNS}`,
        [body.stock, id]
      );
    } else {
      if (!Number.isInteger(body.change) || Math.abs(body.change) > MAX_STOCK) {
        return res.status(400).json({
          message: `change must be a whole number from -${MAX_STOCK} to ${MAX_STOCK}.`,
        });
      }

      // The database does the sum itself, and only if the result stays valid.
      // Two admins adjusting at the same moment cannot overwrite each other.
      result = await pool.query(
        `UPDATE products SET stock = stock + $1, updated_at = NOW()
         WHERE id = $2 AND stock + $1 BETWEEN 0 AND $3
         RETURNING ${COLUMNS}`,
        [body.change, id, MAX_STOCK]
      );

      if (result.rows.length === 0) {
        // Either the product does not exist, or the new stock would be out of range.
        const exists = await pool.query('SELECT 1 FROM products WHERE id = $1', [id]);
        if (exists.rows.length === 0) {
          return res.status(404).json({ message: 'Product not found.' });
        }
        return res.status(409).json({
          message: `That change would take stock below 0 or above ${MAX_STOCK}.`,
        });
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({ message: 'Stock updated.', data: result.rows[0] });
  } catch (error) {
    return serverError(res, 'Update stock error', error);
  }
}

// DELETE /admin/products/:id  → hide the product (soft delete)
async function deleteProduct(req, res) {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: 'Product id must be a positive whole number.' });
    }

    const result = await pool.query(
      `UPDATE products SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({
      message:
        'Product hidden from the shop. It was not erased, so old orders can still refer to it.',
      data: result.rows[0],
    });
  } catch (error) {
    return serverError(res, 'Delete product error', error);
  }
}

module.exports = {
  listAllProducts,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
};