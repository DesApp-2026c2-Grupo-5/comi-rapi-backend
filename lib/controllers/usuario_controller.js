import Usuario from '../models/usuario';

export const index = async (req, res) => {
  const data = await Usuario.findAll({});
  res.json({ data });
};

export const show = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id);
  if (usuario) {
    res.json({ data: usuario });
  } else {
    res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }
};
