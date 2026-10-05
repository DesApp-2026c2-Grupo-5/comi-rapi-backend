import { Op, fn, col } from 'sequelize';
import db from '../models';

const { Usuario, Pedido } = db;

const ROLES_VALIDOS = ['CLIENTE', 'ADMINISTRADOR'];

// Escapa los comodines de LIKE para que el texto buscado sea literal.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const index = async (req, res) => {
  const where = {};
  const { rol, buscar } = req.query || {};

  if (ROLES_VALIDOS.includes(rol)) {
    where.rol = rol;
  }

  const q = (buscar || '').trim();
  if (q) {
    const patron = `%${escaparLike(q)}%`;
    where[Op.or] = [
      { nombre: { [Op.iLike]: patron } },
      { apellido: { [Op.iLike]: patron } },
      { email: { [Op.iLike]: patron } },
    ];
  }

  const usuarios = await Usuario.findAll({
    where,
    order: [
      ['nombre', 'ASC'],
      ['apellido', 'ASC'],
    ],
  });

  // Conteo de pedidos por usuario en una sola query.
  const conteos = await Pedido.findAll({
    attributes: ['usuarioId', [fn('COUNT', col('id')), 'cantidad']],
    where: { usuarioId: usuarios.map((u) => u.id) },
    group: ['usuarioId'],
    raw: true,
  });
  const cantidadPorUsuario = Object.fromEntries(
    conteos.map((c) => [c.usuarioId, Number(c.cantidad)])
  );

  res.json({
    data: usuarios.map((usuario) =>
      usuario.datosAdministracion(cantidadPorUsuario[usuario.id] || 0)
    ),
  });
};

export const show = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id);
  if (usuario) {
    const cantidadPedidos = await Pedido.count({
      where: { usuarioId: usuario.id },
    });
    res.json({ data: usuario.datosAdministracion(cantidadPedidos) });
  } else {
    res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }
};
