const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listOrders,
  getOrder,
  cancelOrder,
} = require('../controllers/orders.controller');

const router = express.Router();

// Every order door needs a valid wristband.
router.use(authenticate);

router.get('/', listOrders);                 // my order history
router.get('/:id', getOrder);                // one of my orders
router.post('/:id/cancel', cancelOrder);     // cancel a pending order

module.exports = router;
