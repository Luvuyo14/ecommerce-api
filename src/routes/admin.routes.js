const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  listAllProducts,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
} = require('../controllers/admin.products.controller');

const router = express.Router();

// Every route in this file needs a valid wristband AND the admin role.
// Order matters: first check who they are, then check they are an admin.
router.use(authenticate, requireAdmin);

// GET /admin/ping  → a test door for admins only
router.get('/ping', (req, res) => {
  res.json({ message: `Welcome, admin ${req.user.email}!` });
});

// Product management (admins only, because of the guards above)
router.get('/products', listAllProducts);          // see everything
router.post('/products', createProduct);           // add a product
router.patch('/products/:id', updateProduct);      // change details
router.patch('/products/:id/stock', updateStock);  // set or adjust stock
router.delete('/products/:id', deleteProduct);     // hide a product

module.exports = router;