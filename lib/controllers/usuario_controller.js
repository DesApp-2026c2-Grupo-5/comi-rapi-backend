import Usuario from '../models/usuario';

export const index = async (req, res) => {
  const data = await Usuario.findAll({});
  res.send({ data });
};
