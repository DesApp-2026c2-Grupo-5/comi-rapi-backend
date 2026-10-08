import db from '../models';
import { Op } from 'sequelize';
import { sucursalDeSesion } from '../middlewares/auth';
import { emitirPedidoActualizado } from '../realtime';
import {
  seleccionarSucursal,
  SinSucursalElegibleError,
} from '../services/seleccion_sucursal_service';
import { calcularEta } from '../services/eta_service';
import {
  reasignarPedido,
  ReasignacionError,
} from '../services/reasignacion_service';
import {
  calcularPrecioPersonalizado,
  calcularPrecioUnitario,
} from '../services/calculo_personalizacion';
import { calcularDescuento } from '../services/promociones';
import { obtenerValores } from '../services/parametros_service';
import {
  descontarStock,
  mensajeDeFaltantes,
  reservasDeStockVencidas,
  reponerStock,
  StockInsuficienteError,
} from '../services/stock';
import {
  ESTADOS_PEDIDO,
  puedeTransicionar,
  puedeTransicionarConRol,
} from '../services/estados_pedido';

const {
  Direccion,
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

/**
 * T0 (plan maestro de pedidos): resuelve la dirección de entrega a partir de
 * la `Direccion` persistida del usuario (que ya pasó el ABM con geocodización
 * obligatoria) y arma el snapshot con coordenadas. Si no viene `direccionId`,
 * cae al payload textual sin coords (retro-compatibilidad). Si la dirección no
 * existe o no es del usuario → 404; sin coords → 422 (defensivo: el ABM las
 * exige).
 */
async function resolverDireccionEntrega(direccionId, usuarioId, payload) {
  if (!direccionId) {
    return extraerDireccion(payload);
  }
  const direccion = await Direccion.findOne({
    where: { id: direccionId, usuarioId, activa: true },
  });
  if (!direccion) {
    return { error: 404, mensaje: 'Dirección de entrega no encontrada' };
  }
  if (direccion.latitud === null || direccion.longitud === null) {
    return {
      error: 422,
      mensaje:
        'La dirección de entrega no tiene coordenadas: volvé a guardarla desde tu perfil',
    };
  }
  // El snapshot de Pedidos conserva la columna 'ciudad': se mapea la
  // 'localidad' normalizada de Georef (puede ser null).
  return {
    calle: direccion.calle,
    altura: Number(direccion.altura),
    ciudad: direccion.localidad !== undefined ? direccion.localidad : null,
    codigoPostal:
      direccion.codigoPostal !== undefined ? direccion.codigoPostal : null,
    referencia:
      direccion.referencia !== undefined ? direccion.referencia : null,
    latitud: Number(direccion.latitud),
    longitud: Number(direccion.longitud),
  };
}

/**
 * Valida los límites de negocio configurables del pedido: unidades por
 * producto, unidades totales y subtotal mínimo/máximo. El subtotal se mide
 * sobre los ítems ANTES de descuentos y envío (así el 2x1 no viola el mínimo).
 *
 * @param {Array} lineas - Líneas ya construidas (con `cantidad` y `subtotal`).
 * @param {object} params - Valores de los parámetros de negocio.
 * @returns {number} subtotal de los ítems.
 */
function validarLimitesDePedido(lineas, params) {
  const {
    cantidadMaximaUnidadesProducto,
    cantidadMaximaItemsPedido,
    montoMinimoPedido,
    montoMaximoPedido,
  } = params;

  const unidadesPorProducto = new Map();
  let unidadesTotales = 0;
  for (const linea of lineas) {
    unidadesTotales += linea.cantidad;
    if (linea.productoId) {
      const clave = String(linea.productoId);
      unidadesPorProducto.set(
        clave,
        (unidadesPorProducto.get(clave) || 0) + linea.cantidad
      );
    }
  }
  if (unidadesTotales > cantidadMaximaItemsPedido) {
    throw new Error(
      `El pedido supera el máximo de ${cantidadMaximaItemsPedido} unidades`
    );
  }
  for (const unidades of unidadesPorProducto.values()) {
    if (unidades > cantidadMaximaUnidadesProducto) {
      throw new Error(
        `No se pueden pedir más de ${cantidadMaximaUnidadesProducto} unidades del mismo producto`
      );
    }
  }

  const subtotal = lineas.reduce((acc, l) => acc + l.subtotal, 0);
  if (subtotal < montoMinimoPedido) {
    throw new Error(
      `El pedido no alcanza el monto mínimo de $${montoMinimoPedido}`
    );
  }
  if (subtotal > montoMaximoPedido) {
    throw new Error(
      `El pedido supera el monto máximo de $${montoMaximoPedido}`
    );
  }
  return subtotal;
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
    let producto = null;
    if (productoId) {
      producto = await Producto.findByPk(productoId, { transaction });
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
      tipo: producto?.tipo || item.tipo || null,
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
    // Un combo nunca se descuenta (el combo ya ES la promoción), así que su línea
    // no cuenta como alcanzada. Si el combo es el único producto que la promoción
    // alcanza, la promoción no aplica a este pedido.
    const alcanza = lineas.some(
      (linea) =>
        linea.tipo !== 'COMBO' &&
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
      tipo: linea.tipo,
    })),
    promos
  );
  return { promos, porPromocion };
}

/**
 * T1 (plan maestro): elige la sucursal del pedido delegando en
 * `seleccion_sucursal_service` — LA MÁS CERCANA POR RUTA con stock
 * suficiente, dentro de cobertura. Si el cliente envía `sucursalId`, se
 * valida que sea elegible y se respeta. Si ninguna cumple → 422.
 */
async function resolverSucursal(sucursalId, lineas, coordenadas, transaction) {
  let sucursalPreferida = null;
  if (sucursalId) {
    sucursalPreferida = await Sucursal.findByPk(sucursalId, { transaction });
    if (!sucursalPreferida || !sucursalPreferida.activa) {
      throw new Error('Sucursal no disponible');
    }
  }
  return seleccionarSucursal({
    lineas: lineasControlables(lineas),
    coordenadas,
    sucursalPreferida,
    transaction,
  });
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
    direccionId,
    direccionEntrega,
    medioPago,
    observacion,
    promocionIds,
  } = req.body || {};
  if (medioPago !== undefined && !MEDIOS_PAGO_VALIDOS.includes(medioPago)) {
    return res
      .status(400)
      .json({ success: false, error: 'Medio de pago inválido' });
  }
  // T0: resuelve el snapshot con coords desde la Direccion persistida del
  // usuario (con direccionId) o cae al payload textual (retro-compatibilidad).
  const snapshotDireccion = await resolverDireccionEntrega(
    direccionId,
    req.usuario.id,
    direccionEntrega
  );
  if (snapshotDireccion.error) {
    return res
      .status(snapshotDireccion.error)
      .json({ success: false, error: snapshotDireccion.mensaje });
  }
  try {
    // El envío y los límites del pedido son reglas del backend: se leen de los
    // parámetros de negocio y NO se toman del body (el cliente no fija precios).
    const params = await obtenerValores([
      'montoMinimoEnvioGratis',
      'costoEnvioFijo',
      'cantidadMaximaUnidadesProducto',
      'cantidadMaximaItemsPedido',
      'montoMinimoPedido',
      'montoMaximoPedido',
    ]);
    const resultado = await db.sequelize.transaction(async (t) => {
      // Las líneas se arman antes que la sucursal: hacen falta para saber qué
      // stock hay que buscar y así elegir una sucursal que tenga todo.
      const lineas = await construirItems(productos, t);
      const totalItems = validarLimitesDePedido(lineas, params);
      // T1: la selección necesita las coords de entrega del snapshot (T0).
      const sucursal = await resolverSucursal(
        sucursalId,
        lineas,
        {
          latitud: snapshotDireccion.latitud,
          longitud: snapshotDireccion.longitud,
        },
        t
      );
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
      const descuentoTotal = porPromocion.reduce(
        (acc, p) => acc + p.descuento,
        0
      );
      // El envío lo decide el backend: gratis a partir del parámetro
      // `montoMinimoEnvioGratis`, si no se cobra el `costoEnvioFijo`.
      const costo =
        totalItems >= params.montoMinimoEnvioGratis ? 0 : params.costoEnvioFijo;
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
          ...snapshotDireccion,
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
    // T1: la selección de sucursal es semántica (dirección sin cobertura o sin
    // stock dentro de ella) → 422, no 400. Si se llegaron a evaluar candidatas
    // con stock parcial, el error trae los faltantes de la mejor y el mensaje
    // informa cuántas unidades reales hay (no el genérico de cobertura).
    if (error instanceof SinSucursalElegibleError) {
      return res.status(422).json({
        success: false,
        error:
          error.faltantes && error.faltantes.length > 0
            ? mensajeDeFaltantes(error.faltantes)
            : error.message,
      });
    }
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const index = async (req, res) => {
  const where = {};
  const rol = req.usuario && req.usuario.rol;
  if (rol === 'ADMINISTRADOR') {
    // El admin sólo ve los pedidos de su sucursal asignada. El filtro
    // `?sucursalId=` no puede ampliarlo a otro local.
    where.sucursalId = Number(sucursalDeSesion(req));
  } else if (rol === 'SUPERADMINISTRADOR') {
    // El superadmin ve todo el negocio (visión global): su detalle de cliente
    // se apoya en este listado y filtra por usuario en el frontend.
  } else {
    where.usuarioId = req.usuario.id;
    // Filtros opcionales (74 Historial): para el CLIENTE se combinan con su
    // propio scope.
    if (req.query.sucursalId) {
      const n = Number(req.query.sucursalId);
      if (!Number.isNaN(n)) where.sucursalId = n;
    }
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
  const rol = req.usuario && req.usuario.rol;
  if (rol === 'ADMINISTRADOR') {
    // Un admin sólo accede a pedidos de su sucursal.
    if (Number(pedido.sucursalId) !== Number(sucursalDeSesion(req))) {
      return res.status(403).json({ success: false, error: 'Acceso denegado' });
    }
  } else if (
    rol !== 'SUPERADMINISTRADOR' &&
    pedido.usuarioId !== req.usuario.id
  ) {
    // El SUPERADMINISTRADOR tiene visión global; el cliente se controla por
    // propiedad.
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
  if (esAdmin) {
    // El admin sólo opera pedidos de su sucursal asignada.
    if (Number(pedido.sucursalId) !== Number(sucursalDeSesion(req))) {
      return res.status(403).json({ success: false, error: 'Acceso denegado' });
    }
  } else if (pedido.usuarioId !== req.usuario.id) {
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
      //
      // La búsqueda usa las MISMAS reglas D1 que la asignación inicial
      // (más cercana por ruta con stock, dentro de cobertura), excluyendo la
      // sucursal original: su reserva venció, ya no es elegible. Antes
      // elegía por "menor carga de pedidos pendientes" entre TODAS las
      // activas y podía reasignar a una sucursal fuera de cobertura.
      if (esConfirmacion) {
        const vencidas = await reservasDeStockVencidas(
          items,
          pedido.sucursalId,
          { transaction: t }
        );
        if (vencidas.length > 0) {
          let destino = null;
          try {
            destino = await seleccionarSucursal({
              lineas: items,
              coordenadas: {
                latitud: Number(pedido.latitud),
                longitud: Number(pedido.longitud),
              },
              exceptoSucursalId: pedido.sucursalId,
              transaction: t,
            });
          } catch (error) {
            if (error instanceof SinSucursalElegibleError) {
              // Ninguna sucursal dentro de cobertura puede armar el pedido:
              // recién ahí se corta el pago y se le avisa al cliente. El
              // pedido queda PENDIENTE y puede cancelarlo. El mensaje usa
              // los faltantes de la mejor candidata evaluada; si no se
              // evaluó ninguna (cobertura vacía o snapshot sin coordenadas
              // de pedidos previos a T0), se informa qué productos perdieron
              // su reserva.
              throw new StockInsuficienteError(
                error.faltantes && error.faltantes.length > 0
                  ? error.faltantes
                  : vencidas.map((v) => ({
                      productoId: v.productoId,
                      nombre: v.nombre,
                      hay: 0,
                      necesario: 0,
                    }))
              );
            }
            throw error;
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

    // T2: calcular el ETA al confirmar. FUERA de la transacción
    // (ORS es un servicio externo; no se bloquea el pago por su latencia).
    // Si la sucursal fue reasignada dentro de la transacción, el ETA usa la
    // nueva (recalcular: la cocina se mantiene, el viaje cambia).
    if (esConfirmacion) {
      const sucursalFinal = await Sucursal.findByPk(pedido.sucursalId, {
        include: [{ model: Direccion, as: 'direccion', required: false }],
      });
      const eta = await calcularEta({
        sucursal: sucursalFinal,
        coordenadasEntrega: {
          latitud: Number(pedido.latitud),
          longitud: Number(pedido.longitud),
        },
      });
      if (eta) {
        await pedido.update({
          etaMinutos: eta.etaMinutos,
          etaCalculadoEn: eta.etaCalculadoEn,
        });
      }
      // eta === null → ORS falló: degradación. El pedido queda confirmado sin
      // ETA; el front muestra "—". El error ya fue logueado por el service.
    }
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
  emitirPedidoActualizado(actualizado.id, actualizado.sucursalId);
  return res.json({ success: true, data: serializar(actualizado) });
};

/**
 * T4: reasignación manual de sucursal por el admin. Valida permisos, carga
 * el pedido con sus items y delega en reasignacion_service (transferencia de
 * stock + trazabilidad + ETA en la misma transacción).
 */
export const reasignarSucursal = async (req, res) => {
  const { sucursalId: nuevaSucursalId } = req.body || {};
  if (!nuevaSucursalId || Number.isNaN(Number(nuevaSucursalId))) {
    return res.status(400).json({
      success: false,
      error: 'La sucursal destino es obligatoria',
    });
  }
  const pedido = await Pedido.findByPk(req.params.id, {
    include: includePedido,
    order: orderPedido,
  });
  if (!pedido) {
    return res
      .status(404)
      .json({ success: false, error: 'Pedido no encontrado' });
  }
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      return reasignarPedido({
        pedido,
        nuevaSucursalId: Number(nuevaSucursalId),
        adminEmail: req.usuario.email,
        transaction: t,
      });
    });
    const actualizado = await Pedido.findByPk(resultado.id, {
      include: includePedido,
      order: orderPedido,
    });
    emitirPedidoActualizado(actualizado.id);
    return res.json({ success: true, data: serializar(actualizado) });
  } catch (error) {
    if (error instanceof ReasignacionError) {
      return res
        .status(error.status || 400)
        .json({ success: false, error: error.message });
    }
    if (error instanceof StockInsuficienteError) {
      return res.status(409).json({
        success: false,
        error: error.message,
        pedidoId: pedido.id,
      });
    }
    // Fix diagnóstico: log del error no tipado antes de propagarlo (el 404
    // que el usuario veía podía ser en realidad un 500 disfrazado).
    // eslint-disable-next-line no-console
    console.error('[reasignarSucursal] Error no tipado:', error.message);
    throw error;
  }
};
