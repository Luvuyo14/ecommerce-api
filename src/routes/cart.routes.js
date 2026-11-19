const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
} = require('../controllers/cart.controller');

const router = express.Router();

// Every cart door needs a valid wristband.
router.use(authenticate);

router.get('/', getCart);                          // see my cart
router.delete('/', clearCart);                     // empty my cart
router.post('/items', addItem);                    // add a product
router.patch('/items/:productId', updateItem);     // change a quantity
router.delete('/items/:productId', removeItem);    // remove a product

module.exports = router;