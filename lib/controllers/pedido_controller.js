import db from '../models';
import { Op } from 'sequelize';
import { emitirPedidoActualizado } from '../realtime';
import { asignarSucursalOptima } from '../services/asignacion_sucursal';
import {
  calcularPrecioPersonalizado,
  calcularPrecioUnitario,
} from '../services/calculo_personalizacion';
import { calcularDescuento } from '../services/promociones';
import {
  descontarStock,
  faltantesDePedido,
  faltantesDeStock,
  reservasDeStockVencidas,
  reponerStock,
  StockInsuficienteError,
} from '../services/stock';
import {
  ESTADOS_PEDIDO,
  ESTADOS_PENDIENTES,
  puedeTransicionar,
  puedeTransicionarConRol,
} from '../services/estados_pedido';

const {
  EstadoPedido,
  Pedido,
  PedidoEstadoHistorial,
  PedidoItem,
  PedidoPromocion,
  Producto,
  Promocion,
  PromocionProducto,
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
  { model: Sucursal, include: 'direccion' },
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
  {
    model: PedidoPromocion,
    as: 'promociones',
    include: [{ model: Promocion, attributes: ['id', 'nombre', 'tipo'] }],
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
    promociones: (json.promociones || []).map((promo) => ({
      promocionId: promo.promocionId,
      nombre: promo.Promocion?.nombre,
      tipo: promo.Promocion?.tipo,
      descuentoAplicado: Number(promo.descuentoAplicado),
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

async function resolverPromociones(promocionIds, lineas, transaction) {
  if (promocionIds === undefined) return { promos: [], porPromocion: [] };
  if (!Array.isArray(promocionIds)) {
    throw new Error('Las promociones deben enviarse como lista de IDs');
  }
  const ids = [...new Set(promocionIds)];
  if (ids.some((id) => !Number.isInteger(Number(id)))) {
    throw new Error('ID de promoción inválido');
  }
  if (ids.length === 0) return { promos: [], porPromocion: [] };
  const ahora = new Date();
  const promos = [];
  for (const id of ids) {
    const promocion = await Promocion.findByPk(Number(id), { transaction });
    if (!promocion || !promocion.activa) {
      throw new Error(`Promoción ${id} no disponible`);
    }
    if (promocion.fechaInicio && new Date(promocion.fechaInicio) > ahora) {
      throw new Error(`Promoción ${id} aún no vigente`);
    }
    if (promocion.fechaFin && new Date(promocion.fechaFin) < ahora) {
      throw new Error(`Promoción ${id} vencida`);
    }
    const vinculos = await PromocionProducto.findAll({
      where: { promocionId: promocion.id },
      transaction,
    });
    const productoIds = vinculos.map((v) => v.productoId);
    const alcanza = lineas.some((linea) =>
      productoIds.some((pid) => String(pid) === String(linea.productoId))
    );
    if (!alcanza) {
      throw new Error(`La promoción ${id} no aplica a este pedido`);
    }
    promos.push({
      id: promocion.id,
      tipo: promocion.tipo,
      valor: Number(promocion.valor),
      productoIds,
    });
  }
  const { porPromocion } = calcularDescuento(
    lineas.map((linea) => ({
      productoId: linea.productoId,
      precioUnitario: linea.precioUnitario,
      cantidad: linea.cantidad,
    })),
    promos
  );
  return { promos, porPromocion };
}

/**
 * Sucursales que tienen stock suficiente para todas las líneas del pedido.
 *
 * Se devuelven todas las que alcanzan, no sólo la primera, porque al reasignar
 * un pedido ya creado puede haber más de una opción y hay que elegir entre
 * ellas.
 */
async function sucursalesConStock(lineas, sucursales, transaction) {
  const conStock = [];
  for (const sucursal of sucursales) {
    const faltantes = await faltantesDeStock(lineas, sucursal.id, {
      transaction,
    });
    if (faltantes.length === 0) conStock.push(sucursal);
  }
  return conStock;
}

/**
 * Sucursal activa (distinta de `exceptoId`) que puede armar todo el pedido, o
 * `null` si no hay ninguna. Se usa al confirmar el pago, cuando la sucursal que
 * tenía el pedido se quedó sin stock: el cliente no tiene que volver al carrito,
 * se le cambia la sucursal y sigue.
 */
async function buscarSucursalConTodo(items, exceptoId, transaction) {
  const candidatas = await sucursalesActivas({ id: exceptoId }, transaction);
  const conStock = await sucursalesConStock(items, candidatas, transaction);
  if (conStock.length === 0) return null;
  return asignarSucursalOptima(conStock, await pedidosPendientes(transaction));
}

/**
 * Faltantes del pedido informing desde la sucursal que más stock tiene: si
 * ninguna puede armarlo completo, se avisa con la que quedó más cerca, que es
 * la que menos cosas le faltan.
 */
async function faltantesEnSucursalMasProvista(items, sucursales, transaction) {
  let mejor = null;
  for (const sucursal of sucursales) {
    const faltantes = await faltantesDePedido(items, sucursal.id, {
      transaction,
    });
    if (mejor === null || faltantes.length < mejor.length) mejor = faltantes;
    if (mejor.length === 0) break;
  }
  return mejor ?? [];
}

/**
 * Elige la sucursal del pedido.
 *
 * La asignación automática sigue siendo por menor carga de pedidos pendientes
 * (ver `asignacion_sucursal`), pero sólo entre las sucursales que realmente
 * tienen stock: elegir la más descargada sin stock haría fallar el pedido. Si la
 * sucursal pedida explícitamente no tiene stock, se cae al mismo reparto
 * automático entre las que sí tienen.
 *
 * @param {number|null} sucursalId - Sucursal elegida a mano, si la hay.
 * @param {Array} lineas - Líneas del pedido ya construidas (con `subtotal`).
 * @param {object} transaction
 * @returns {Promise<object>} La sucursal asignada.
 */
async function resolverSucursal(sucursalId, lineas, transaction) {
  const controlables = lineasControlables(lineas);

  let pedida = null;
  if (sucursalId) {
    pedida = await Sucursal.findByPk(sucursalId, { transaction });
    if (!pedida || !pedida.activa) {
      throw new Error('Sucursal no disponible');
    }
  }

  // Sin control de stock (líneas sueltas sin `productoId`) no hay nada que
  // filtrar: alcanza con la asignación por carga.
  if (controlables.length === 0) {
    if (pedida) return pedida;
    return elegirPorCarga(null, transaction);
  }

  if (pedida) {
    const faltantes = await faltantesDeStock(controlables, pedida.id, {
      transaction,
    });
    // La sucursal elegida a mano tiene stock: se respeta, sin repartir.
    if (faltantes.length === 0) return pedida;
  }

  const candidatas = await sucursalesActivas(pedida, transaction);
  const conStock = await sucursalesConStock(
    controlables,
    candidatas,
    transaction
  );
  if (conStock.length > 0) {
    return asignarSucursalOptima(
      conStock,
      await pedidosPendientes(transaction)
    );
  }

  // Ninguna sucursal tiene todo el stock. Se informa con el faltante de la
  // sucursal que el cliente venía usando, o de la primera activa si no vino
  // ninguna: así el mensaje nombra algo que el cliente puede reconocer.
  const referencia = pedida ?? (await sucursalesActivas(null, transaction))[0];
  throw new StockInsuficienteError(
    await faltantesDePedido(controlables, referencia.id, { transaction })
  );
}

/** Sucursales activas candidatas, ordenada por id. */
async function sucursalesActivas(excepto, transaction) {
  return Sucursal.findAll({
    where: {
      activa: true,
      ...(excepto ? { id: { [Op.ne]: excepto.id } } : {}),
    },
    order: [['id', 'ASC']],
    transaction,
  });
}

/** Pedidos en estados pendientes, para medir la carga de cada sucursal. */
async function pedidosPendientes(transaction) {
  const estadosPend = await EstadoPedido.findAll({
    where: { nombre: ESTADOS_PENDIENTES },
    transaction,
  });
  const idsPend = estadosPend.map((e) => e.id);
  if (!idsPend.length) return [];
  return Pedido.findAll({
    where: { estadoId: idsPend },
    attributes: ['sucursalId'],
    transaction,
  });
}

/** Reparto por menor carga, sin mirar stock. */
async function elegirPorCarga(excepto, transaction) {
  const candidatas = await sucursalesActivas(excepto, transaction);
  const optima = asignarSucursalOptima(
    candidatas,
    await pedidosPendientes(transaction)
  );
  if (!optima) throw new Error('No hay sucursales disponibles');
  return optima;
}

/**
 * Líneas que se controlan contra el stock. `construirItems` acepta líneas
 * sueltas sin `productoId` (nombre + precio), que no pertenecen al catálogo y por
 * lo tanto no tienen stock que descontar.
 */
function lineasControlables(lineas) {
  return lineas.filter((linea) => linea.productoId);
}

export const create = async (req, res) => {
  const {
    productos,
    sucursalId,
    direccionEntrega,
    costoEnvio = 0,
    medioPago,
    observacion,
    promocionIds,
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
      // Las líneas se arman antes que la sucursal: hacen falta para saber qué
      // stock hay que buscar y así elegir una sucursal que tenga todo.
      const lineas = await construirItems(productos, t);
      const sucursal = await resolverSucursal(sucursalId, lineas, t);
      // El descuento es atómico y va en la misma transacción, así que dos
      // pedidos simultáneos no sobrevenden.
      await descontarStock(lineasControlables(lineas), sucursal.id, {
        transaction: t,
      });
      const { porPromocion } = await resolverPromociones(
        promocionIds,
        lineas,
        t
      );
      const totalItems = lineas.reduce((acc, l) => acc + l.subtotal, 0);
      const descuentoTotal = porPromocion.reduce(
        (acc, p) => acc + p.descuento,
        0
      );
      const estadoInicial = await resolverEstado(ESTADOS_PEDIDO.PENDIENTE);
      const pedido = await Pedido.create(
        {
          usuarioId: req.usuario.id,
          sucursalId: sucursal.id,
          estadoId: estadoInicial.id,
          costoEnvio: costo,
          total: Math.round((totalItems + costo - descuentoTotal) * 100) / 100,
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
      if (porPromocion.length > 0) {
        await PedidoPromocion.bulkCreate(
          porPromocion.map((p) => ({
            pedidoId: pedido.id,
            promocionId: p.promocionId,
            descuentoAplicado: Math.round(p.descuento * 100) / 100,
          })),
          { transaction: t }
        );
      }
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
    // No se emite ningún evento al crear: el pedido nace `pendiente` y el
    // panel de administración no muestra los pendientes, así que un aviso acá
    // no le aportaría nada. El admin se entera al confirmarse el pago, que es
    // lo que dispara `pedido_actualizado` desde `cambiarEstado`.
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
  }
  // Filtros opcionales (74 Historial): valen para CLIENTE (con scope) y ADMIN.
  if (req.query.sucursalId) {
    const n = Number(req.query.sucursalId);
    if (!Number.isNaN(n)) where.sucursalId = n;
  }
  if (req.query.estado) {
    const est = await EstadoPedido.findOne({
      where: { nombre: String(req.query.estado) },
    });
    if (!est) return res.json({ success: true, data: [] });
    where.estadoId = est.id;
  }
  const { desde, hasta } = req.query || {};
  if (desde || hasta) {
    const rango = {};
    let hayRango = false;
    if (desde) {
      const d = new Date(desde);
      if (!Number.isNaN(d.getTime())) {
        rango[Op.gte] = d;
        hayRango = true;
      }
    }
    if (hasta) {
      const h = new Date(hasta);
      if (!Number.isNaN(h.getTime())) {
        h.setHours(23, 59, 59, 999);
        rango[Op.lte] = h;
        hayRango = true;
      }
    }
    // OJO: las claves Op.* son Symbols, Object.keys no las ve.
    if (hayRango) where.fechaHora = rango;
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
  const { estado, observacion, medioPago } = req.body || {};
  if (!estado) {
    return res
      .status(400)
      .json({ success: false, error: 'El estado es obligatorio' });
  }
  if (medioPago !== undefined && !MEDIOS_PAGO_VALIDOS.includes(medioPago)) {
    return res
      .status(400)
      .json({ success: false, error: 'Medio de pago inválido' });
  }
  const pedido = await Pedido.findByPk(req.params.id, {
    include: [
      { model: EstadoPedido, as: 'estadoActual' },
      { model: PedidoItem, as: 'items' },
    ],
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
  const esDueño = pedido.usuarioId === req.usuario.id;
  const rol = esAdmin ? 'ADMINISTRADOR' : 'CLIENTE';
  if (!puedeTransicionarConRol(actual, estado, rol, esDueño)) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  const esConfirmacion =
    actual === ESTADOS_PEDIDO.PENDIENTE && estado === ESTADOS_PEDIDO.CONFIRMADO;
  if (esConfirmacion && !MEDIOS_PAGO_VALIDOS.includes(medioPago)) {
    return res.status(400).json({
      success: false,
      error: 'Medio de pago obligatorio para confirmar',
    });
  }
  const nuevo = await resolverEstado(estado);
  try {
    await db.sequelize.transaction(async (t) => {
      const items = lineasControlables(pedido.items);
      let sucursalIdFinal = pedido.sucursalId;

      // El stock se descontó al crear el pedido, así que el pedido "reservó" sus
      // unidades. Entre el carrito y el pago el admin puede desactivar el
      // producto, bajar la cantidad o apagar un componente del combo: si la
      // reserva ya no está, no se le pide al cliente que arme el pedido de nuevo,
      // se le busca otra sucursal que sí pueda prepararlo y el pago sigue.
      if (esConfirmacion) {
        const vencidas = await reservasDeStockVencidas(
          items,
          pedido.sucursalId,
          { transaction: t }
        );
        if (vencidas.length > 0) {
          const destino = await buscarSucursalConTodo(
            items,
            pedido.sucursalId,
            t
          );
          if (destino === null) {
            // Ninguna sucursal tiene stock: recién ahí se corta el pago y se le
            // avisa al cliente. El pedido queda PENDIENTE y puede cancelarlo.
            throw new StockInsuficienteError(
              await faltantesEnSucursalMasProvista(
                items,
                await sucursalesActivas(null, t),
                t
              )
            );
          }
          // Se suelta la reserva de la sucursal vieja y se toma la de la nueva
          // dentro de la misma transacción: si algo falla, el pedido se queda con
          // la sucursal de antes y el stock queda como estaba.
          await reponerStock(items, pedido.sucursalId, { transaction: t });
          await descontarStock(items, destino.id, { transaction: t });
          sucursalIdFinal = destino.id;
        }
      }

      await pedido.update(
        {
          estadoId: nuevo.id,
          ...(sucursalIdFinal !== pedido.sucursalId
            ? { sucursalId: sucursalIdFinal }
            : {}),
          ...(medioPago !== undefined ? { medioPago } : {}),
        },
        { transaction: t }
      );
      await PedidoEstadoHistorial.create(
        {
          pedidoId: pedido.id,
          estadoId: nuevo.id,
          usuarioId: req.usuario.id,
          observacion: observacion || null,
        },
        { transaction: t }
      );
      // Cancelar devuelve las unidades al stock de la sucursal. Solo se repone lo
      // que se descontó al crear (líneas con productoId del catálogo).
      if (estado === ESTADOS_PEDIDO.CANCELADO) {
        await reponerStock(
          lineasControlables(pedido.items),
          pedido.sucursalId,
          {
            transaction: t,
          }
        );
      }
    });
  } catch (error) {
    // La falta de stock es la única situación en la que el pago se frena, y el
    // mensaje ya está escrito para el cliente. Todo lo demás es un error real y
    // lo toma el manejador global.
    if (error instanceof StockInsuficienteError) {
      return res.status(409).json({
        success: false,
        error: error.message,
        pedidoId: pedido.id,
        estado: actual,
      });
    }
    throw error;
  }
  const actualizado = await Pedido.findByPk(pedido.id, {
    include: includePedido,
    order: orderPedido,
  });
  // Igual que en `create`: la transacción ya commiteó y el pedido se relejo
  // con el estado nuevo. Recién entonces se notifica a admins y al dueño.
  emitirPedidoActualizado(actualizado.id);
  return res.json({ success: true, data: serializar(actualizado) });
};
