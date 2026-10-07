import { Op, fn, col } from 'sequelize';
import db from '../models';
import {
  ErrorValidacionUsuario,
  UsuarioNoEncontradoError,
  actualizarUsuario,
  crearUsuario,
} from '../services/usuario_service';

const { Usuario, Pedido } = db;

const ROLES_VALIDOS = ['CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'];

// Escapa los comodines de LIKE para que el texto buscado sea literal.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const index = async (req, res) => {
  const where = {};
  const { rol, buscar } = req.query || {};

  /* Alcance según el rol autenticado:
   * - ADMINISTRADOR: solo los CLIENTE que hicieron al menos un pedido en su
   *   sucursal (el filtro `rol` se ignora; no gestiona otros administradores ni
   *   clientes que nunca pidieron en su local).
   * - SUPERADMINISTRADOR: todos los usuarios registrados, respetando los
   *   filtros `rol`/`buscar`.
   */
  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  if (esAdmin) {
    where.rol = 'CLIENTE';
    const filas = await Pedido.findAll({
      attributes: ['usuarioId'],
      where: { sucursalId: req.usuario.sucursalId },
      group: ['usuarioId'],
      raw: true,
    });
    const idsConPedidos = filas.map((f) => f.usuarioId).filter(Boolean);
    where.id = { [Op.in]: idsConPedidos };
  } else if (ROLES_VALIDOS.includes(rol)) {
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

  // Conteo de pedidos por usuario en una sola query. Para el admin, solo los
  // pedidos de su sucursal (el número refleja lo que gestiona en su local).
  const dondeConteos = esAdmin
    ? {
        usuarioId: usuarios.map((u) => u.id),
        sucursalId: req.usuario.sucursalId,
      }
    : { usuarioId: usuarios.map((u) => u.id) };
  const conteos = await Pedido.findAll({
    attributes: ['usuarioId', [fn('COUNT', col('id')), 'cantidad']],
    where: dondeConteos,
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
  if (!usuario) {
    return res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }

  // El admin solo puede ver el detalle de un CLIENTE de su sucursal que haya
  // pedido al menos una vez (coincide con lo que le muestra el listado).
  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  if (esAdmin && usuario.rol === 'CLIENTE') {
    const cantidadPedidos = await Pedido.count({
      where: {
        usuarioId: usuario.id,
        sucursalId: req.usuario.sucursalId,
      },
    });
    if (cantidadPedidos === 0) {
      return res.status(404).json({
        message: `No se encontró un usuario con id ${req.params.id}`,
      });
    }
    return res.json({ data: usuario.datosAdministracion(cantidadPedidos) });
  }
  if (esAdmin) {
    return res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }

  const cantidadPedidos = await Pedido.count({
    where: { usuarioId: usuario.id },
  });
  res.json({ data: usuario.datosAdministracion(cantidadPedidos) });
};

// El recurso /api/usuarios usa `{ data }` / `{ message }` (ver swagger), no el
// sobre `{ success, data|error }`. Los errores de validación del service se
// traducen acá para respetar ese formato.
export const create = async (req, res, next) => {
  try {
    const data = await crearUsuario(req.body || {});
    return res.status(201).json({ data });
  } catch (error) {
    if (error instanceof ErrorValidacionUsuario) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const data = await actualizarUsuario(
      Number(req.params.id),
      req.body || {},
      {
        actorId: req.usuario && req.usuario.id,
      }
    );
    return res.json({ data });
  } catch (error) {
    if (error instanceof UsuarioNoEncontradoError) {
      return res.status(404).json({ message: error.message });
    }
    if (error instanceof ErrorValidacionUsuario) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
};
