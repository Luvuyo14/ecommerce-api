const pool = require('../config/db');

const MAX_ID = 2147483647;  // the biggest number PostgreSQL's SERIAL can hold
const MAX_PER_ITEM = 99;    // the most of one product you can have in a cart

// ---------- small helpers ----------

// Turns a value into a safe id number, or null if it is not valid.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

function isValidQuantity(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PER_ITEM;
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res
    .status(500)
    .json({ message: 'Something went wrong. Please try again later.' });
}

// Builds the cart for one user: every line, its total and the grand total.
async function loadCart(userId) {
  const result = await pool.query(
    `SELECT ci.product_id, p.name, p.price_cents, p.stock, p.is_active, ci.quantity
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.id`,
    [userId]
  );

  const items = result.rows.map((row) => ({
    product_id: row.product_id,
    name: row.name,
    price_cents: row.price_cents,
    quantity: row.quantity,
    line_total_cents: row.price_cents * row.quantity,
    // false if the shop hid the product, or if there is now less stock than you want
    available: row.is_active && row.stock >= row.quantity,
  }));

  return {
    items,
    item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    total_cents: items.reduce((sum, item) => sum + item.line_total_cents, 0),
    has_unavailable_items: items.some((item) => !item.available),
  };
}

// ---------- the doors ----------

// GET /cart  → show my cart
async function getCart(req, res) {
  try {
    // req.user.id comes from the wristband, never from the request itself.
    const cart = await loadCart(req.user.id);
    return res.json({ data: cart });
  } catch (error) {
    return serverError(res, 'Get cart error', error);
  }
}

// POST /cart/items  → add a product
async function addItem(req, res) {
  try {
    const { product_id, quantity = 1 } = req.body ?? {};

    const productId = parseId(product_id);
    if (productId === null) {
      return res
        .status(400)
        .json({ message: 'product_id must be a positive whole number.' });
    }
    if (!isValidQuantity(quantity)) {
      return res.status(400).json({
        message: `quantity must be a whole number from 1 to ${MAX_PER_ITEM}.`,
      });
    }

    // 1. Does the product exist and is it for sale? (Hidden products count as missing.)
    const productResult = await pool.query(
      'SELECT id, stock FROM products WHERE id = $1 AND is_active = TRUE',
      [productId]
    );
    const product = productResult.rows[0];
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // 2. How many of it are already in MY cart?
    const existingResult = await pool.query(
      'SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2',
      [req.user.id, productId]
    );
    const alreadyInCart = existingResult.rows[0]?.quantity ?? 0;
    const newQuantity = alreadyInCart + quantity;

    // 3. Check the limits
    if (product.stock === 0) {
      return res.status(409).json({ message: 'This product is out of stock.' });
    }
    if (newQuantity > MAX_PER_ITEM) {
      return res.status(409).json({
        message: `You can have at most ${MAX_PER_ITEM} of one product in your cart.`,
      });
    }
    if (newQuantity > product.stock) {
      const note = alreadyInCart > 0 ? ` and you already have ${alreadyInCart} in your cart` : '';
      return res
        .status(409)
        .json({ message: `Only ${product.stock} in stock${note}.` });
    }

    // 4. Save it. If this product is already in my cart, ON CONFLICT updates that line.
    await pool.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
      [req.user.id, productId, newQuantity]
    );

    const cart = await loadCart(req.user.id);
    return res.json({ message: 'Added to cart.', data: cart });
  } catch (error) {
    return serverError(res, 'Add to cart error', error);
  }
}

// PATCH /cart/items/:productId  → set the quantity of one line
async function updateItem(req, res) {
  try {
    const productId = parseId(req.params.productId);
    if (productId === null) {
      return res
        .status(400)
        .json({ message: 'Product id must be a positive whole number.' });
    }

    const { quantity } = req.body ?? {};
    if (!isValidQuantity(quantity)) {
      return res.status(400).json({
        message: `quantity must be a whole number from 1 to ${MAX_PER_ITEM}. To remove the item, use DELETE.`,
      });
    }

    // Is this product in MY cart?
    const lineResult = await pool.query(
      'SELECT id FROM cart_items WHERE user_id = $1 AND product_id = $2',
      [req.user.id, productId]
    );
    if (lineResult.rows.length === 0) {
      return res.status(404).json({ message: 'That product is not in your cart.' });
    }

    // Is it still for sale, and is there enough stock?
    const productResult = await pool.query(
      'SELECT stock FROM products WHERE id = $1 AND is_active = TRUE',
      [productId]
    );
    const product = productResult.rows[0];
    if (!product) {
      return res.status(409).json({
        message: 'This product is no longer available. Please remove it from your cart.',
      });
    }
    if (quantity > product.stock) {
      return res.status(409).json({ message: `Only ${product.stock} in stock.` });
    }

    await pool.query(
      `UPDATE cart_items SET quantity = $1, updated_at = NOW()
       WHERE user_id = $2 AND product_id = $3`,
      [quantity, req.user.id, productId]
    );

    const cart = await loadCart(req.user.id);
    return res.json({ message: 'Cart updated.', data: cart });
  } catch (error) {
    return serverError(res, 'Update cart error', error);
  }
}

// DELETE /cart/items/:productId  → remove one product from my cart
async function removeItem(req, res) {
  try {
    const productId = parseId(req.params.productId);
    if (productId === null) {
      return res
        .status(400)
        .json({ message: 'Product id must be a positive whole number.' });
    }

    // "AND user_id = $1" is the ownership rule: I can only delete from MY cart.
    const result = await pool.query(
      'DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2 RETURNING id',
      [req.user.id, productId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'That product is not in your cart.' });
    }

    const cart = await loadCart(req.user.id);
    return res.json({ message: 'Removed from cart.', data: cart });
  } catch (error) {
    return serverError(res, 'Remove from cart error', error);
  }
}

// DELETE /cart  → empty my whole cart
async function clearCart(req, res) {
  try {
    await pool.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);

    const cart = await loadCart(req.user.id);
    return res.json({ message: 'Cart emptied.', data: cart });
  } catch (error) {
    return serverError(res, 'Clear cart error', error);
  }
}

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };