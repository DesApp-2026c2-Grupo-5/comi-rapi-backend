const express = require('express');

const { index, show } = require('../controllers/usuario_controller');
const { withErrorHandling } = require('./utils');

const router = express.Router();

router.get('/', withErrorHandling(index));
router.get('/:id', withErrorHandling(show));

module.exports = router;
