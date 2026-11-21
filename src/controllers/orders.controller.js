const pool = require('../config/db');

const DEFAULT_LIMIT = 10;   // orders per page if the customer doesn't say
const MAX_LIMIT = 50;       // never send more than this in one go
const MAX_ID = 2147483647;  // the biggest number PostgreSQL's SERIAL can hold

// ---------- small helpers ----------

function parsePositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res
    .status(500)
    .json({ message: 'Something went wrong. Please try again later.' });
}

// Loads one order (with its items) that belongs to this user.
// "db" is either the normal pool, or a transaction's own connection.
async function loadOrder(userId, orderId, db = pool) {
  // "AND user_id = $2" is the ownership rule: you only ever see YOUR orders.
  const orderResult = await db.query(
    `SELECT id, status, total_cents, created_at, updated_at
     FROM orders
     WHERE id = $1 AND user_id = $2`,
    [orderId, userId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await db.query(
    `SELECT product_id, product_name, unit_price_cents, quantity
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  return {
    ...order,
    items: itemsResult.rows.map((item) => ({
      ...item,
      line_total_cents: item.unit_price_cents * item.quantity,
    })),
  };
}

// Undo a transaction without letting a second error hide the first one.
async function safeRollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    console.error('Rollback error:', rollbackError.message);
  }
}

// ---------- the doors ----------

// POST /checkout  → turn my cart into an order
async function checkout(req, res) {
  // A transaction must use ONE connection from start to finish,
  // so we borrow a connection ("client") instead of using pool.query.
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // open the all-or-nothing box

    // 1. Read my cart and LOCK each product row (FOR UPDATE OF p).
    //    If another checkout is buying the same product right now,
    //    we wait here until it finishes, then we see the fresh stock.
    //    ORDER BY product_id means everyone locks in the same order,
    //    which stops two checkouts from waiting on each other forever (a "deadlock").
    const cartResult = await client.query(
      `SELECT ci.product_id, ci.quantity,
              p.name, p.price_cents, p.stock, p.is_active
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1
       ORDER BY ci.product_id
       FOR UPDATE OF p`,
      [req.user.id]
    );
    const lines = cartResult.rows;

    if (lines.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Your cart is empty.' });
    }

    // 2. Check every line. Collect ALL the problems so the customer can fix them at once.
    const problems = [];
    for (const line of lines) {
      if (!line.is_active) {
        problems.push(`${line.name} is no longer available.`);
      } else if (line.stock === 0) {
        problems.push(`${line.name} is out of stock.`);
      } else if (line.stock < line.quantity) {
        problems.push(
          `${line.name}: only ${line.stock} left, but you have ${line.quantity} in your cart.`
        );
      }
    }

    if (problems.length > 0) {
      await client.query('ROLLBACK'); // nothing was changed, so nothing to undo
      return res.status(409).json({
        message: 'Some items in your cart cannot be bought right now.',
        problems,
      });
    }

    // 3. Work out the total from the CURRENT prices
    const total = lines.reduce((sum, line) => sum + line.price_cents * line.quantity, 0);

    // 4. Create the order (the receipt)
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, total_cents)
       VALUES ($1, 'pending', $2)
       RETURNING id`,
      [req.user.id, total]
    );
    const orderId = orderResult.rows[0].id;

    // 5. Copy each line into the receipt (with the frozen name and price)
    //    and take the items off the shelf.
    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, line.product_id, line.name, line.price_cents, line.quantity]
      );

      await client.query(
        `UPDATE products SET stock = stock - $1, updated_at = NOW()
         WHERE id = $2`,
        [line.quantity, line.product_id]
      );
    }

    // 6. Empty my cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);

    // 7. Read the finished order back, then seal the box.
    const order = await loadOrder(req.user.id, orderId, client);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Order created. Waiting for payment.',
      data: order,
    });
  } catch (error) {
    await safeRollback(client); // any surprise: undo everything
    return serverError(res, 'Checkout error', error);
  } finally {
    client.release(); // always give the connection back
  }
}

// GET /orders?page=1&limit=10  → my order history
async function listOrders(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM orders WHERE user_id = $1',
      [req.user.id]
    );
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT id, status, total_cents, created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    return res.json({
      data: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return serverError(res, 'List orders error', error);
  }
}

// GET /orders/:id  → one of my orders
async function getOrder(req, res) {
  try {
    const orderId = parseId(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ message: 'Order id must be a positive whole number.' });
    }

    const order = await loadOrder(req.user.id, orderId);

    // Someone else's order gets the same answer as an order that doesn't exist,
    // so nobody can find out which order numbers are in use.
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    return res.json({ data: order });
  } catch (error) {
    return serverError(res, 'Get order error', error);
  }
}

// POST /orders/:id/cancel  → cancel my pending order and put the stock back
async function cancelOrder(req, res) {
  const orderId = parseId(req.params.id);
  if (orderId === null) {
    return res.status(400).json({ message: 'Order id must be a positive whole number.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock MY order row, so it cannot be paid and cancelled at the same moment.
    const orderResult = await client.query(
      'SELECT id, status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Order not found.' });
    }

    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Only pending orders can be cancelled. This order is ${order.status}.`,
      });
    }

    // Put every item back on the shelf (same lock order as checkout)
    const itemsResult = await client.query(
      `SELECT product_id, quantity FROM order_items
       WHERE order_id = $1
       ORDER BY product_id`,
      [orderId]
    );
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE products SET stock = stock + $1, updated_at = NOW()
         WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    const updated = await loadOrder(req.user.id, orderId, client);
    await client.query('COMMIT');

    return res.json({
      message: 'Order cancelled and stock returned.',
      data: updated,
    });
  } catch (error) {
    await safeRollback(client);
    return serverError(res, 'Cancel order error', error);
  } finally {
    client.release();
  }
}

module.exports = { checkout, listOrders, getOrder, cancelOrder };
