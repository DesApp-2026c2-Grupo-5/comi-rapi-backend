import db from '../models';
import { asignarSucursalOptima } from '../services/asignacion_sucursal';
import {
  calcularPrecioPersonalizado,
  calcularPrecioUnitario,
} from '../services/calculo_personalizacion';
import {
  ESTADOS_PEDIDO,
  ESTADOS_PENDIENTES,
  puedeTransicionar,
} from '../services/estados_pedido';

const {
  EstadoPedido,
  Pedido,
  PedidoEstadoHistorial,
  PedidoItem,
  Producto,
  Sucursal,
  Usuario,
} = db;

const MEDIOS_PAGO_VALIDOS = ['MERCADO_PAGO', 'TARJETA'];

// Orden global de pedidos: recientes primero; historial cronológico;
// items en orden de carga. Se aplica en index/show y en los re-fetch
// de create/cambiarEstado para una serialización consistente.
const orderPedido = [
  ['fechaHora', 'DESC'],
  [{ model: PedidoEstadoHistorial, as: 'historial' }, 'fechaHora', 'ASC'],
  [{ model: PedidoEstadoHistorial, as: 'historial' }, 'id', 'ASC'],
  [{ model: PedidoItem, as: 'items' }, 'id', 'ASC'],
];

const includePedido = [
  {
    model: Usuario,
    as: 'cliente',
    attributes: ['id', 'nombre', 'apellido', 'email'],
  },
  { model: Sucursal },
  { model: EstadoPedido, as: 'estadoActual' },
  {
    model: PedidoItem,
    as: 'items',
    include: [{ model: Producto, attributes: ['id', 'nombre', 'precio'] }],
  },
  {
    model: PedidoEstadoHistorial,
    as: 'historial',
    include: [{ model: EstadoPedido }],
  },
];

const serializar = (pedido) => {
  const json = pedido.toJSON ? pedido.toJSON() : pedido;
  return {
    ...json,
    total: json.total !== undefined ? Number(json.total) : json.total,
    costoEnvio:
      json.costoEnvio !== undefined ? Number(json.costoEnvio) : json.costoEnvio,
    estado: json.estadoActual ? json.estadoActual.nombre : undefined,
    items: (json.items || []).map((item) => ({
      ...item,
      precioUnitario: Number(item.precioUnitario),
      subtotal: Number(item.subtotal),
    })),
  };
};

async function resolverEstado(nombre) {
  const estado = await EstadoPedido.findOne({ where: { nombre } });
  if (!estado) throw new Error(`Estado "${nombre}" no configurado`);
  return estado;
}

function extraerDireccion(direccionEntrega) {
  if (!direccionEntrega || typeof direccionEntrega !== 'object') return {};
  const {
    calle,
    altura,
    ciudad,
    codigoPostal,
    referencia,
    latitud,
    longitud,
  } = direccionEntrega;
  return {
    calle: calle !== undefined ? String(calle) : null,
    altura: altura !== undefined ? Number(altura) : null,
    ciudad: ciudad !== undefined ? String(ciudad) : null,
    codigoPostal: codigoPostal !== undefined ? String(codigoPostal) : null,
    referencia: referencia !== undefined ? String(referencia) : null,
    latitud: latitud !== undefined ? Number(latitud) : null,
    longitud: longitud !== undefined ? Number(longitud) : null,
  };
}

async function construirItems(productos, transaction) {
  if (!Array.isArray(productos) || productos.length === 0) {
    throw new Error('El pedido debe tener al menos un producto');
  }
  const lineas = [];
  for (const item of productos) {
    const cantidad = Number(item.cantidad ?? 1);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new Error('Cantidad inválida en una línea del pedido');
    }
    let nombreProducto = item.nombreProducto || item.nombre;
    let precioBase = item.precio ?? item.precioUnitario;
    let productoId = item.productoId || null;
    if (productoId) {
      const producto = await Producto.findByPk(productoId, { transaction });
      if (!producto || !producto.activo) {
        throw new Error(`Producto ${productoId} no disponible`);
      }
      nombreProducto = producto.nombre;
      precioBase = Number(producto.precio);
    }
    if (!nombreProducto || Number.isNaN(Number(precioBase))) {
      throw new Error('Cada línea debe tener nombre y precio válidos');
    }
    const extras = item.personalizacion?.extras || item.extras || [];
    const acomp =
      item.personalizacion?.acompanamientos || item.acompanamientos || [];
    const precioUnitario = calcularPrecioUnitario(precioBase, extras, acomp);
    const subtotal = calcularPrecioPersonalizado(
      precioBase,
      extras,
      acomp,
      cantidad
    );
    let observacion = item.observacion || null;
    if (!observacion && item.personalizacion) {
      observacion = JSON.stringify(item.personalizacion);
    }
    lineas.push({
      productoId,
      nombreProducto: String(nombreProducto),
      precioUnitario,
      cantidad,
      subtotal,
      observacion,
    });
  }
  return lineas;
}

async function resolverSucursal(sucursalId, transaction) {
  if (sucursalId) {
    const sucursal = await Sucursal.findByPk(sucursalId, { transaction });
    if (!sucursal || !sucursal.activa) {
      throw new Error('Sucursal no disponible');
    }
    return sucursal;
  }
  const sucursales = await Sucursal.findAll({
    where: { activa: true },
    order: [['id', 'ASC']],
    transaction,
  });
  const estadosPend = await EstadoPedido.findAll({
    where: { nombre: ESTADOS_PENDIENTES },
    transaction,
  });
  const idsPend = estadosPend.map((e) => e.id);
  const pendientes = idsPend.length
    ? await Pedido.findAll({
        where: { estadoId: idsPend },
        attributes: ['sucursalId'],
        transaction,
      })
    : [];
  const optima = asignarSucursalOptima(sucursales, pendientes);
  if (!optima) throw new Error('No hay sucursales disponibles');
  return optima;
}

export const create = async (req, res) => {
  const {
    productos,
    sucursalId,
    direccionEntrega,
    costoEnvio = 0,
    medioPago,
    observacion,
  } = req.body || {};
  if (medioPago !== undefined && !MEDIOS_PAGO_VALIDOS.includes(medioPago)) {
    return res
      .status(400)
      .json({ success: false, error: 'Medio de pago inválido' });
  }
  const costo = Number(costoEnvio);
  if (Number.isNaN(costo) || costo < 0) {
    return res
      .status(400)
      .json({ success: false, error: 'Costo de envío inválido' });
  }
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      const sucursal = await resolverSucursal(sucursalId, t);
      const lineas = await construirItems(productos, t);
      const totalItems = lineas.reduce((acc, l) => acc + l.subtotal, 0);
      const estadoInicial = await resolverEstado(ESTADOS_PEDIDO.PENDIENTE);
      const pedido = await Pedido.create(
        {
          usuarioId: req.usuario.id,
          sucursalId: sucursal.id,
          estadoId: estadoInicial.id,
          costoEnvio: costo,
          total: totalItems + costo,
          medioPago: medioPago || null,
          observacion: observacion || null,
          ...extraerDireccion(direccionEntrega),
        },
        { transaction: t }
      );
      await PedidoItem.bulkCreate(
        lineas.map((l) => ({ ...l, pedidoId: pedido.id })),
        { transaction: t }
      );
      await PedidoEstadoHistorial.create(
        {
          pedidoId: pedido.id,
          estadoId: estadoInicial.id,
          usuarioId: req.usuario.id,
          observacion: 'Pedido creado',
        },
        { transaction: t }
      );
      return pedido.id;
    });
    const creado = await Pedido.findByPk(resultado, {
      include: includePedido,
      order: orderPedido,
    });
    return res.status(201).json({ success: true, data: serializar(creado) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const index = async (req, res) => {
  const where = {};
  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  if (!esAdmin) {
    where.usuarioId = req.usuario.id;
  } else if (req.query.sucursalId) {
    where.sucursalId = Number(req.query.sucursalId);
  }
  const pedidos = await Pedido.findAll({
    where,
    include: includePedido,
    order: orderPedido,
  });
  return res.json({ success: true, data: pedidos.map(serializar) });
};

export const show = async (req, res) => {
  const pedido = await Pedido.findByPk(req.params.id, {
    include: includePedido,
    order: orderPedido,
  });
  if (!pedido) {
    return res
      .status(404)
      .json({ success: false, error: 'Pedido no encontrado' });
  }
  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  if (!esAdmin && pedido.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  return res.json({ success: true, data: serializar(pedido) });
};

export const cambiarEstado = async (req, res) => {
  const { estado, observacion } = req.body || {};
  if (!estado) {
    return res
      .status(400)
      .json({ success: false, error: 'El estado es obligatorio' });
  }
  const pedido = await Pedido.findByPk(req.params.id, {
    include: [{ model: EstadoPedido, as: 'estadoActual' }],
  });
  if (!pedido) {
    return res
      .status(404)
      .json({ success: false, error: 'Pedido no encontrado' });
  }
  const esAdmin = req.usuario && req.usuario.rol === 'ADMINISTRADOR';
  if (!esAdmin && pedido.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  const actual = pedido.estadoActual.nombre;
  if (!puedeTransicionar(actual, estado)) {
    return res.status(400).json({
      success: false,
      error: `Transición inválida de "${actual}" a "${estado}"`,
    });
  }
  const esConfirmacionCliente =
    actual === ESTADOS_PEDIDO.PENDIENTE && estado === ESTADOS_PEDIDO.CONFIRMADO;
  if (!esAdmin && !esConfirmacionCliente) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  const nuevo = await resolverEstado(estado);
  await db.sequelize.transaction(async (t) => {
    await pedido.update({ estadoId: nuevo.id }, { transaction: t });
    await PedidoEstadoHistorial.create(
      {
        pedidoId: pedido.id,
        estadoId: nuevo.id,
        usuarioId: req.usuario.id,
        observacion: observacion || null,
      },
      { transaction: t }
    );
  });
  const actualizado = await Pedido.findByPk(pedido.id, {
    include: includePedido,
    order: orderPedido,
  });
  return res.json({ success: true, data: serializar(actualizado) });
};
