const Usuario = require('../models/usuario');

const index = async (req, res) => {
  const usuarios = await Usuario.findAll({});
  res.json({ data: usuarios.map((usuario) => usuario.toJSON()) });
};

const show = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id);
  if (usuario) {
    res.json({ data: usuario.toJSON() });
  } else {
    res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }
};

module.exports = { index, show };
