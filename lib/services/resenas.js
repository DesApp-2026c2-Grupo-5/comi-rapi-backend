import { fn, col } from 'sequelize';
import db from '../models';

const { EstadoPedido, Pedido, PedidoItem, Producto, Resena, Usuario } = db;

/** Único estado que habilita una reseña: el producto ya se compró y recibió. */
export const ESTADO_RESENABLE = 'entregado';

const PUNTUACION_MIN = 1;
const PUNTUACION_MAX = 5;
const COMENTARIO_MAX = 500;
const LIMITE_DEFAULT = 10;
const LIMITE_MAX = 50;

/**
 * Error de negocio de reseñas. El controller traduce `codigo` al status HTTP:
 * 400 validación, 403 sin compra entregada, 404 no existe / no es propia,
 * 409 ya existe una reseña.
 */
export class ResenaError extends Error {
  constructor(mensaje, codigo = 400) {
    super(mensaje);
    this.name = 'ResenaError';
    this.codigo = codigo;
  }
}

const validarPuntuacion = (puntuacion) => {
  const valor = Number(puntuacion);
  if (
    !Number.isInteger(valor) ||
    valor < PUNTUACION_MIN ||
    valor > PUNTUACION_MAX
  ) {
    throw new ResenaError(
      `La puntuación debe ser un número entero entre ${PUNTUACION_MIN} y ${PUNTUACION_MAX}`
    );
  }
  return valor;
};

const normalizarComentario = (comentario) => {
  if (comentario === undefined || comentario === null) return null;
  const texto = String(comentario).trim();
  if (!texto) return null;
  if (texto.length > COMENTARIO_MAX) {
    throw new ResenaError(
      `El comentario no puede superar los ${COMENTARIO_MAX} caracteres`
    );
  }
  return texto;
};

/**
 * Nombre público del autor: nombre + inicial del apellido ("María G.").
 * Nunca se expone el email ni el apellido completo.
 */
const nombreVisible = (autor) => {
  if (!autor) return 'Cliente';
  const nombre = (autor.nombre || '').trim();
  if (!nombre) return 'Cliente';
  const inicial = (autor.apellido || '').trim().charAt(0).toUpperCase();
  return inicial ? `${nombre} ${inicial}.` : nombre;
};

const serializarResena = (resena) => ({
  id: resena.id,
  productoId: resena.productoId,
  puntuacion: resena.puntuacion,
  comentario: resena.comentario,
  creadaEn: resena.createdAt,
  actualizadaEn: resena.updatedAt,
  autor: { nombre: nombreVisible(resena.autor) },
});

const serializarMiResena = (resena) => ({
  ...serializarResena(resena),
  producto: resena.producto
    ? {
        id: resena.producto.id,
        nombre: resena.producto.nombre,
        imagen: resena.producto.imagen,
        tipo: resena.producto.tipo,
      }
    : null,
});

const buscarConAutor = async (id) => {
  const resena = await Resena.findByPk(id, {
    include: [
      { model: Usuario, as: 'autor', attributes: ['nombre', 'apellido'] },
    ],
  });
  return resena ? serializarResena(resena) : null;
};

/**
 * Promedio y cantidad de reseñas de un producto. Se calcula en la base y se
 * devuelve 0 cuando todavía no hay ninguna.
 */
export const resumenDeProducto = async (productoId) => {
  const fila = await Resena.findOne({
    where: { productoId },
    attributes: [
      [fn('AVG', col('puntuacion')), 'promedio'],
      [fn('COUNT', col('id')), 'cantidad'],
    ],
    raw: true,
  });
  const cantidad = Number((fila && fila.cantidad) || 0);
  const promedio = cantidad ? Math.round(Number(fila.promedio) * 10) / 10 : 0;
  return { promedio, cantidad };
};

/**
 * Listado público y paginado de reseñas de un producto.
 *
 * @param {number} productoId
 * @param {{ pagina?: number|string, limite?: number|string }} opciones
 * @returns {Promise<object>} promedio, cantidad, items y paginación.
 */
export const listarResenasDeProducto = async (
  productoId,
  { pagina = 1, limite = LIMITE_DEFAULT } = {}
) => {
  const producto = await Producto.findByPk(productoId, {
    attributes: ['id'],
  });
  if (!producto) throw new ResenaError('Producto no encontrado', 404);

  const paginaNum = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(
    LIMITE_MAX,
    Math.max(1, Number.parseInt(limite, 10) || LIMITE_DEFAULT)
  );

  const { count, rows } = await Resena.findAndCountAll({
    where: { productoId },
    include: [
      { model: Usuario, as: 'autor', attributes: ['nombre', 'apellido'] },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limiteNum,
    offset: (paginaNum - 1) * limiteNum,
    distinct: true,
  });

  const resumen = await resumenDeProducto(productoId);

  return {
    ...resumen,
    items: rows.map(serializarResena),
    total: count,
    pagina: paginaNum,
    limite: limiteNum,
    paginas: Math.ceil(count / limiteNum),
  };
};

/**
 * Pedido entregado del cliente que incluye el producto (el más reciente).
 * Devuelve null si nunca lo compró o si sólo tiene pedidos no entregados.
 */
const pedidoEntregadoConProducto = (usuarioId, productoId) =>
  Pedido.findOne({
    where: { usuarioId },
    include: [
      {
        model: EstadoPedido,
        as: 'estadoActual',
        required: true,
        where: { nombre: ESTADO_RESENABLE },
        attributes: [],
      },
      {
        model: PedidoItem,
        as: 'items',
        required: true,
        where: { productoId },
        attributes: ['id'],
      },
    ],
    order: [
      ['fechaHora', 'DESC'],
      ['id', 'DESC'],
    ],
  });

/**
 * Productos y combos que el cliente puede reseñar: los que aparecen en alguno
 * de sus pedidos entregados y todavía no tienen reseña suya.
 *
 * @param {number} usuarioId
 * @param {{ pedidoId?: number|string }} opciones - Acota a un pedido puntual.
 * @returns {Promise<Array<object>>} Un item por producto, con el pedido que lo
 *   habilitó (el más reciente).
 */
export const productosElegibles = async (usuarioId, { pedidoId } = {}) => {
  const where = { usuarioId };
  if (pedidoId !== undefined && pedidoId !== null && pedidoId !== '') {
    const id = Number(pedidoId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ResenaError('El pedido indicado no es válido');
    }
    where.id = id;
  }

  const pedidos = await Pedido.findAll({
    where,
    attributes: ['id', 'fechaHora'],
    include: [
      {
        model: EstadoPedido,
        as: 'estadoActual',
        required: true,
        where: { nombre: ESTADO_RESENABLE },
        attributes: [],
      },
      {
        model: PedidoItem,
        as: 'items',
        required: true,
        attributes: ['productoId'],
        include: [
          {
            model: Producto,
            required: true,
            attributes: ['id', 'nombre', 'imagen', 'tipo'],
          },
        ],
      },
    ],
    order: [
      ['fechaHora', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  const yaResenados = await Resena.findAll({
    where: { usuarioId },
    attributes: ['productoId'],
    raw: true,
  });
  const excluidos = new Set(yaResenados.map((r) => r.productoId));

  const elegibles = new Map();
  for (const pedido of pedidos) {
    for (const item of pedido.items) {
      const producto = item.Producto;
      if (
        !producto ||
        excluidos.has(producto.id) ||
        elegibles.has(producto.id)
      ) {
        continue;
      }
      elegibles.set(producto.id, {
        productoId: producto.id,
        pedidoId: pedido.id,
        nombre: producto.nombre,
        imagen: producto.imagen,
        tipo: producto.tipo,
      });
    }
  }
  return [...elegibles.values()];
};

/**
 * Reseñas del cliente, con el producto al que pertenecen.
 */
export const misResenas = async (usuarioId) => {
  const filas = await Resena.findAll({
    where: { usuarioId },
    include: [
      { model: Usuario, as: 'autor', attributes: ['nombre', 'apellido'] },
      {
        model: Producto,
        as: 'producto',
        attributes: ['id', 'nombre', 'imagen', 'tipo'],
      },
    ],
    order: [
      ['updatedAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  return filas.map(serializarMiResena);
};

/**
 * Crea la reseña de un producto comprado y entregado.
 *
 * @param {{ usuarioId: number, productoId: number|string,
 *   puntuacion: number|string, comentario?: string }} datos
 */
export const crearResena = async ({
  usuarioId,
  productoId,
  puntuacion,
  comentario,
}) => {
  const idProducto = Number(productoId);
  if (!Number.isInteger(idProducto) || idProducto <= 0) {
    throw new ResenaError('El producto es obligatorio');
  }

  const producto = await Producto.findByPk(idProducto, {
    attributes: ['id', 'activo'],
  });
  if (!producto) throw new ResenaError('Producto no encontrado', 404);
  if (!producto.activo) {
    throw new ResenaError('El producto ya no está disponible');
  }

  const valor = validarPuntuacion(puntuacion);
  const texto = normalizarComentario(comentario);

  const existente = await Resena.findOne({
    where: { usuarioId, productoId: idProducto },
    attributes: ['id'],
  });
  if (existente) {
    throw new ResenaError('Ya dejaste una reseña para este producto', 409);
  }

  const pedido = await pedidoEntregadoConProducto(usuarioId, idProducto);
  if (!pedido) {
    throw new ResenaError(
      'Solo podés reseñar productos de tus pedidos entregados',
      403
    );
  }

  try {
    const resena = await Resena.create({
      usuarioId,
      productoId: idProducto,
      pedidoId: pedido.id,
      puntuacion: valor,
      comentario: texto,
    });
    return await buscarConAutor(resena.id);
  } catch (error) {
    // Dos pestañas pueden competir por la misma reseña: el UNIQUE de la base
    // es la última palabra, no el chequeo previo.
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new ResenaError('Ya dejaste una reseña para este producto', 409);
    }
    throw error;
  }
};

/**
 * Edita la reseña propia. Un id ajeno responde 404 (no se filtra que exista).
 */
export const actualizarResena = async (
  id,
  usuarioId,
  { puntuacion, comentario }
) => {
  const resena = await Resena.findByPk(id);
  if (!resena || resena.usuarioId !== usuarioId) {
    throw new ResenaError('Reseña no encontrada', 404);
  }

  const valor = validarPuntuacion(puntuacion);
  const texto =
    comentario === undefined
      ? resena.comentario
      : normalizarComentario(comentario);

  await resena.update({ puntuacion: valor, comentario: texto });
  return buscarConAutor(resena.id);
};

/**
 * Elimina la reseña propia. Un id ajeno responde 404.
 */
export const eliminarResena = async (id, usuarioId) => {
  const resena = await Resena.findByPk(id);
  if (!resena || resena.usuarioId !== usuarioId) {
    throw new ResenaError('Reseña no encontrada', 404);
  }
  await resena.destroy();
};
