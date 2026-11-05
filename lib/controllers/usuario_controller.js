import { Op, fn, col } from 'sequelize';
import db from '../models';
import {
  ErrorValidacionUsuario,
  UsuarioNoEncontradoError,
  actualizarUsuario,
  crearUsuario,
} from '../services/usuario_service';
import { productosYCategoriasMasComprados } from '../services/estadisticas_cliente_service';
import { serializar as serializarDireccion } from './direccion_controller';

const { Direccion, EstadoPedido, Usuario, Pedido } = db;

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
  } else {
    const roles = String(rol || '')
      .split(',')
      .map((valor) => valor.trim())
      .filter((valor) => ROLES_VALIDOS.includes(valor));
    if (roles.length === 1) {
      where.rol = roles[0];
    } else if (roles.length > 1) {
      where.rol = { [Op.in]: roles };
    }
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

  // Paginación opt-in: sin `pagina`/`limite` la respuesta sigue siendo el array
  // completo de siempre.
  const paginar =
    req.query.pagina !== undefined || req.query.limite !== undefined;
  const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const limite = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limite, 10) || 20)
  );
  const orden = [
    ['nombre', 'ASC'],
    ['apellido', 'ASC'],
    ['id', 'ASC'],
  ];

  let usuarios;
  let total = null;
  if (paginar) {
    [total, usuarios] = await Promise.all([
      Usuario.count({ where }),
      Usuario.findAll({
        where,
        order: orden,
        limit: limite,
        offset: (pagina - 1) * limite,
      }),
    ]);
  } else {
    usuarios = await Usuario.findAll({ where, order: orden });
  }

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

  const data = usuarios.map((usuario) =>
    usuario.datosAdministracion(cantidadPorUsuario[usuario.id] || 0)
  );
  if (!paginar) return res.json({ data });
  return res.json({
    data: {
      items: data,
      total,
      pagina,
      limite,
      paginas: Math.ceil(total / limite),
    },
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

/**
 * Productos y categorías que más compró un cliente (`GET /api/usuarios/:id/mas-comprados`).
 *
 * El alcance es el mismo que el de `show`, y por las mismas razones: el admin
 * sólo puede ver clientes de su sucursal y sólo cuenta lo que se pidió en SU
 * local; el superadmin ve a cualquiera y suma todos sus pedidos.
 */
export const masComprados = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id);
  if (!usuario) {
    return res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }

  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  let sucursalId = null;

  if (esAdmin) {
    // Mismo requisito que `show`: si nunca pidió en este local, el admin no
    // tiene por qué verlo (coincide con lo que le muestra el listado).
    if (usuario.rol !== 'CLIENTE') {
      return res
        .status(404)
        .json({ message: `No se encontró un usuario con id ${req.params.id}` });
    }
    const cantidadPedidos = await Pedido.count({
      where: { usuarioId: usuario.id, sucursalId: req.usuario.sucursalId },
    });
    if (cantidadPedidos === 0) {
      return res
        .status(404)
        .json({ message: `No se encontró un usuario con id ${req.params.id}` });
    }
    sucursalId = req.usuario.sucursalId;
  }

  const data = await productosYCategoriasMasComprados(usuario.id, {
    sucursalId,
  });
  return res.json({ data });
};

/**
 * Ficha completa del cliente en una sola llamada
 * (`GET /api/usuarios/:id/resumen`): datos, direcciones activas, últimos tres
 * pedidos y ranking de productos/categorías. Reutiliza exactamente el alcance de
 * `show`/`masComprados`: el admin sólo ve clientes de su sucursal y sólo cuenta
 * lo pedido en su local; el superadmin ve todo.
 */
export const resumen = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id);
  if (!usuario) {
    return res
      .status(404)
      .json({ message: `No se encontró un usuario con id ${req.params.id}` });
  }

  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  const wherePedidos = { usuarioId: usuario.id };
  let cantidadPedidos;

  if (esAdmin) {
    if (usuario.rol !== 'CLIENTE') {
      return res
        .status(404)
        .json({ message: `No se encontró un usuario con id ${req.params.id}` });
    }
    wherePedidos.sucursalId = req.usuario.sucursalId;
    cantidadPedidos = await Pedido.count({ where: wherePedidos });
    if (cantidadPedidos === 0) {
      return res.status(404).json({
        message: `No se encontró un usuario con id ${req.params.id}`,
      });
    }
  }

  const [
    direcciones,
    pedidos,
    masCompradosData,
    totalPedidos,
  ] = await Promise.all([
    Direccion.findAll({
      where: { usuarioId: usuario.id, activa: true },
      order: [['id', 'ASC']],
    }),
    Pedido.findAll({
      where: wherePedidos,
      attributes: ['id', 'fechaHora', 'total', 'sucursalId', 'estadoId'],
      include: [
        {
          model: EstadoPedido,
          as: 'estadoActual',
          attributes: ['id', 'nombre'],
        },
      ],
      order: [
        ['fechaHora', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 3,
    }),
    productosYCategoriasMasComprados(usuario.id, {
      sucursalId: esAdmin ? req.usuario.sucursalId : null,
    }),
    cantidadPedidos === undefined
      ? Pedido.count({ where: wherePedidos })
      : Promise.resolve(cantidadPedidos),
  ]);

  return res.json({
    data: {
      cliente: usuario.datosAdministracion(totalPedidos),
      direcciones: direcciones.map(serializarDireccion),
      ultimosPedidos: pedidos.map((pedido) => {
        const json = pedido.toJSON();
        return {
          id: json.id,
          fecha: json.fechaHora,
          fechaHora: json.fechaHora,
          total: Number(json.total),
          estado: json.estadoActual ? json.estadoActual.nombre : null,
          estadoId: json.estadoId,
          sucursalId: json.sucursalId,
        };
      }),
      masComprados: masCompradosData,
    },
  });
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
