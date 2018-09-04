const express = require('express');
const { controller } = require('../controllers/formFillerCtrl');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.send('Please use POST method instead');
});

/**
 * Recieve POST request with the following params:
 * req.body
 * - id: {integer/string}
 * - created_date: DATE OF CREATE ID. Format: 'DD/MM/YYYY' {String}
 * - anwser1: 'yes/no' {String}
 * - anwser2: 'yes/no' {String}
 */
router.post('/', controller);

module.exports = router;
