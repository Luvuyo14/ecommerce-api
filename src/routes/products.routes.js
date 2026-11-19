const express = require('express');
const { listProducts, getProduct } = require('../controllers/products.controller');

const router = express.Router();

// Anyone can browse: no wristband needed.
router.get('/', listProducts);    // GET /products
router.get('/:id', getProduct);   // GET /products/5

module.exports = router;