const express = require('express');
const { controller } = require('../controllers/formFillerCtrl');
const { testEndpoint } = require('../controllers/testEndpointCtrl');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.send('Please use POST method instead');
});

/**
 * Main endpoint
 */
router.post('/', controller);

/**
 * Test endpoint 
 */
router.post('/api/', testEndpoint)


module.exports = router;
