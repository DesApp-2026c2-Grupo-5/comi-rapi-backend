const express = require('express');
const usuarios = require('./usuarios');

const router = express.Router();

router.use('/api/usuarios', usuarios);

module.exports = router;
