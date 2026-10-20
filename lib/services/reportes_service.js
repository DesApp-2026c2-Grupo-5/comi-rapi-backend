/**
 * Service: reportes y estadísticas del negocio.
 *
 * Todo se agrega en la base (COUNT / SUM / AVG / GROUP BY). La definición de
 * "venta" es única en todo el sistema: pedido en estado `entregado`. El importe
 * es `Pedido.total`, que incluye el envío y ya viene neto de descuentos.
 *
 * El `sucursalId` llega resuelto desde el controller: para un ADMINISTRADOR es
 * siempre el de su sesión; para el SUPERADMINISTRADOR es el filtro opcional.
 */

import { fn, col, Op, literal, QueryTypes } from 'sequelize';
import db from '../models';
import { obtenerValor } from './parametros_service';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoItem,
  PedidoPromocion,
  Producto,
  Promocion,
  Stock,
  Sucursal,
  Usuario,
} = db;

/** Único estado que se considera venta/facturación. */
export const ESTADO_VENTA = 'entregado';

/** Clave del parámetro que habilita el reporte de stock crítico. */
export const CLAVE_UMBRAL_STOCK = 'stockCriticoUmbral';

const DIAS_POR_DEFECTO = 30;
const LIMITE_PRODUCTOS = 10;
const LIMITE_CLIENTES = 10;

/**
 * Los reportes se expresan en la hora del negocio, no en la del servidor ni en
 * UTC: un pedido de las 22:00 debe caer en el día y la franja correctos.
 */
const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

const NOMBRES_DIA = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

/** El período pedido no tiene un formato válido. */
export class PeriodoInvalidoError extends Error {
  constructor(mensaje) {
    super(mensaje || 'El período indicado no es válido');
    this.name = 'PeriodoInvalidoError';
  }
}

/** El filtro de sucursal del superadmin no existe. */
export class SucursalInexistenteError extends Error {
  constructor(sucursalId) {
    super(`No existe una sucursal con id ${sucursalId}`);
    this.name = 'SucursalInexistenteError';
    this.sucursalId = sucursalId;
  }
}

const dosDigitos = (numero) => String(numero).padStart(2, '0');

const FORMATO_ZONA = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Partes de calendario de un instante en la zona del negocio. */
function partesEnZona(fecha) {
  const partes = {};
  FORMATO_ZONA.formatToParts(fecha).forEach(({ type, value }) => {
    if (type !== 'literal') partes[type] = Number(value);
  });
  return partes;
}

/** Clave `YYYY-MM-DD` en la zona del negocio. */
function claveDePartes({ year, month, day }) {
  return `${year}-${dosDigitos(month)}-${dosDigitos(day)}`;
}

/** Desplazamiento (ms) de la zona del negocio en un instante dado. */
function offsetZona(instante) {
  const partes = partesEnZona(new Date(instante));
  return (
    Date.UTC(
      partes.year,
      partes.month - 1,
      partes.day,
      partes.hour,
      partes.minute,
      partes.second
    ) - instante
  );
}

/** Instante UTC que corresponde a una fecha/hora de la zona del negocio. */
function instanteEnZona(partes, hora = 0) {
  const ingenuo = Date.UTC(partes.year, partes.month - 1, partes.day, hora);
  return new Date(ingenuo - offsetZona(ingenuo));
}

function sumarDias({ year, month, day }, dias) {
  const fecha = new Date(Date.UTC(year, month - 1, day + dias));
  return {
    year: fecha.getUTCFullYear(),
    month: fecha.getUTCMonth() + 1,
    day: fecha.getUTCDate(),
  };
}

/** Parsea `YYYY-MM-DD` como partes de calendario; null si no es real. */
function parseFecha(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return null;
  }
  const [year, month, day] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  if (
    fecha.getUTCFullYear() !== year ||
    fecha.getUTCMonth() !== month - 1 ||
    fecha.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Normaliza y valida el período. Sin parámetros usa los últimos 30 días
 * (incluyendo hoy en la zona del negocio). Devuelve los instantes de los
 * límites y las claves `YYYY-MM-DD`.
 *
 * @param {string} [desde] - `YYYY-MM-DD`.
 * @param {string} [hasta] - `YYYY-MM-DD`.
 */
export function validarPeriodo(desde, hasta) {
  const hayDesde = desde !== undefined && desde !== '';
  const hayHasta = hasta !== undefined && hasta !== '';

  if (!hayDesde && !hayHasta) {
    const hoy = partesEnZona(new Date());
    const hoyClave = claveDePartes(hoy);
    const inicio = sumarDias(hoy, -(DIAS_POR_DEFECTO - 1));
    return {
      desde: instanteEnZona(inicio),
      hasta: instanteEnZona(hoy),
      hastaExclusivo: instanteEnZona(sumarDias(hoy, 1)),
      desdeClave: claveDePartes(inicio),
      hastaClave: hoyClave,
    };
  }

  if (!hayDesde || !hayHasta) {
    throw new PeriodoInvalidoError(
      'Tenés que indicar desde y hasta juntos (YYYY-MM-DD)'
    );
  }

  const inicio = parseFecha(desde);
  const fin = parseFecha(hasta);
  if (!inicio || !fin) {
    throw new PeriodoInvalidoError('Las fechas deben tener formato YYYY-MM-DD');
  }
  const desdeClave = claveDePartes(inicio);
  const hastaClave = claveDePartes(fin);
  if (hastaClave < desdeClave) {
    throw new PeriodoInvalidoError(
      'La fecha desde no puede ser posterior a la hasta'
    );
  }

  return {
    desde: instanteEnZona(inicio),
    hasta: instanteEnZona(fin),
    hastaExclusivo: instanteEnZona(sumarDias(fin, 1)),
    desdeClave,
    hastaClave,
  };
}

/** Días (claves) entre dos fechas, ambas incluidas. */
function diasDelPeriodo(periodo) {
  const dias = [];
  const inicio = parseFecha(periodo.desdeClave);
  const finClave = periodo.hastaClave;
  let cursor = inicio;
  while (claveDePartes(cursor) <= finClave) {
    dias.push(claveDePartes(cursor));
    cursor = sumarDias(cursor, 1);
  }
  return dias;
}

/** Promedio redondeado a dos decimales (0 si no hay base). */
function promedio(total, cantidad) {
  if (!cantidad) return 0;
  return Math.round((total / cantidad) * 100) / 100;
}

/** Filtro de fecha + sucursal para pedidos. */
function wherePedidos(periodo, sucursalId) {
  const where = {
    fechaHora: { [Op.gte]: periodo.desde, [Op.lt]: periodo.hastaExclusivo },
  };
  if (sucursalId) where.sucursalId = sucursalId;
  return where;
}

/** Include que restringe a pedidos entregados. */
function includeEntregado() {
  return [
    {
      model: EstadoPedido,
      as: 'estadoActual',
      attributes: [],
      required: true,
      where: { nombre: ESTADO_VENTA },
    },
  ];
}

/** Período inmediatamente anterior de la misma longitud. */
function periodoAnterior(periodo) {
  const inicio = parseFecha(periodo.desdeClave);
  const longitud = diasDelPeriodo(periodo).length;
  const hasta = sumarDias(inicio, -1);
  const desde = sumarDias(inicio, -longitud);
  return {
    desde: instanteEnZona(desde),
    hasta: instanteEnZona(hasta),
    hastaExclusivo: periodo.desde,
    desdeClave: claveDePartes(desde),
    hastaClave: claveDePartes(hasta),
  };
}

/** Totales de pedidos y facturación (solo entregados) de un período. */
async function totalesDePeriodo(periodo, sucursalId) {
  const where = wherePedidos(periodo, sucursalId);
  const include = includeEntregado();
  const [pedidos, entregados, facturacion] = await Promise.all([
    Pedido.count({ where }),
    Pedido.count({ where, include }),
    Pedido.sum('total', { where, include }),
  ]);
  return {
    pedidos,
    entregados,
    facturacion: Number(facturacion || 0),
  };
}

/** Variación porcentual contra el período anterior; null si no es comparable. */
function variacion(actual, anterior) {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

async function armarResumen(periodo, sucursalId) {
  const [actual, anterior] = await Promise.all([
    totalesDePeriodo(periodo, sucursalId),
    totalesDePeriodo(periodoAnterior(periodo), sucursalId),
  ]);
  return {
    pedidos: actual.pedidos,
    entregados: actual.entregados,
    facturacion: actual.facturacion,
    ticketPromedio: promedio(actual.facturacion, actual.entregados),
    anterior: {
      desde: periodoAnterior(periodo).desdeClave,
      hasta: periodoAnterior(periodo).hastaClave,
      pedidos: anterior.pedidos,
      entregados: anterior.entregados,
      facturacion: anterior.facturacion,
      ticketPromedio: promedio(anterior.facturacion, anterior.entregados),
      variacionFacturacion: variacion(actual.facturacion, anterior.facturacion),
      variacionPedidos: variacion(actual.entregados, anterior.entregados),
    },
  };
}

async function armarPorDia(periodo, sucursalId) {
  const diaLiteral = literal(
    `to_char("fechaHora" AT TIME ZONE '${ZONA_HORARIA}', 'YYYY-MM-DD')`
  );
  const where = wherePedidos(periodo, sucursalId);
  const [todos, entregados] = await Promise.all([
    Pedido.findAll({
      attributes: [
        [diaLiteral, 'dia'],
        [fn('COUNT', col('Pedido.id')), 'pedidos'],
      ],
      where,
      group: [diaLiteral],
      raw: true,
    }),
    Pedido.findAll({
      attributes: [
        [diaLiteral, 'dia'],
        [fn('COUNT', col('Pedido.id')), 'entregados'],
        [fn('SUM', col('Pedido.total')), 'facturacion'],
      ],
      where,
      include: includeEntregado(),
      group: [diaLiteral],
      raw: true,
    }),
  ]);

  const porDia = new Map(
    diasDelPeriodo(periodo).map((dia) => [
      dia,
      { dia, pedidos: 0, entregados: 0, facturacion: 0 },
    ])
  );
  todos.forEach((fila) => {
    const actual = porDia.get(fila.dia);
    if (actual) actual.pedidos = Number(fila.pedidos);
  });
  entregados.forEach((fila) => {
    const actual = porDia.get(fila.dia);
    if (actual) {
      actual.entregados = Number(fila.entregados);
      actual.facturacion = Number(fila.facturacion || 0);
    }
  });
  return Array.from(porDia.values());
}

async function armarPorEstado(periodo, sucursalId) {
  const [filas, estados] = await Promise.all([
    Pedido.findAll({
      attributes: [
        [col('estadoActual.nombre'), 'estado'],
        [fn('COUNT', col('Pedido.id')), 'cantidad'],
        [fn('SUM', col('Pedido.total')), 'importe'],
      ],
      include: [
        {
          model: EstadoPedido,
          as: 'estadoActual',
          attributes: [],
          required: true,
        },
      ],
      where: wherePedidos(periodo, sucursalId),
      group: [col('estadoActual.nombre')],
      raw: true,
    }),
    EstadoPedido.findAll({
      attributes: ['nombre', 'orden'],
      order: [['orden', 'ASC']],
    }),
  ]);

  const porNombre = new Map(filas.map((fila) => [fila.estado, fila]));
  return estados.map((estado) => {
    const fila = porNombre.get(estado.nombre);
    return {
      estado: estado.nombre,
      cantidad: fila ? Number(fila.cantidad) : 0,
      importe: fila ? Number(fila.importe || 0) : 0,
    };
  });
}

async function armarPorSucursal(periodo, sucursalId) {
  const whereSucursal = sucursalId ? { id: sucursalId } : { activa: true };
  const where = wherePedidos(periodo, sucursalId);
  const [sucursales, todos, entregados] = await Promise.all([
    Sucursal.findAll({
      where: whereSucursal,
      attributes: ['id', 'nombre'],
      order: [['nombre', 'ASC']],
    }),
    Pedido.findAll({
      attributes: [
        [col('Sucursal.id'), 'sucursalId'],
        [fn('COUNT', col('Pedido.id')), 'pedidos'],
      ],
      include: [
        {
          model: Sucursal,
          attributes: [],
          required: true,
          where: whereSucursal,
        },
      ],
      where,
      group: [col('Sucursal.id')],
      raw: true,
    }),
    Pedido.findAll({
      attributes: [
        [col('Sucursal.id'), 'sucursalId'],
        [fn('COUNT', col('Pedido.id')), 'entregados'],
        [fn('SUM', col('Pedido.total')), 'facturacion'],
      ],
      include: [
        ...includeEntregado(),
        {
          model: Sucursal,
          attributes: [],
          required: true,
          where: whereSucursal,
        },
      ],
      where,
      group: [col('Sucursal.id')],
      raw: true,
    }),
  ]);

  const pedidosPorId = new Map(
    todos.map((fila) => [Number(fila.sucursalId), Number(fila.pedidos)])
  );
  const ventasPorId = new Map(
    entregados.map((fila) => [Number(fila.sucursalId), fila])
  );

  return sucursales.map((sucursal) => {
    const venta = ventasPorId.get(sucursal.id);
    return {
      sucursalId: sucursal.id,
      sucursal: sucursal.nombre,
      pedidos: pedidosPorId.get(sucursal.id) || 0,
      entregados: venta ? Number(venta.entregados) : 0,
      facturacion: venta ? Number(venta.facturacion || 0) : 0,
    };
  });
}

async function armarRankingProductos(periodo, sucursalId) {
  const filas = await PedidoItem.findAll({
    attributes: [
      'productoId',
      [fn('SUM', col('PedidoItem.cantidad')), 'unidades'],
      [fn('SUM', col('PedidoItem.subtotal')), 'facturacion'],
      [fn('MIN', col('PedidoItem.nombreProducto')), 'nombreHistorico'],
    ],
    where: { productoId: { [Op.ne]: null } },
    include: [
      {
        model: Pedido,
        attributes: [],
        required: true,
        where: wherePedidos(periodo, sucursalId),
        include: includeEntregado(),
      },
    ],
    group: ['PedidoItem.productoId'],
    raw: true,
  });

  if (filas.length === 0) {
    return { masVendidos: [], mayorFacturacion: [], menosVendido: null };
  }

  const ids = filas.map((fila) => Number(fila.productoId));
  const productos = await Producto.findAll({
    where: { id: ids },
    attributes: ['id', 'nombre'],
    include: [
      { model: Categoria, as: 'Categoria', attributes: ['id', 'nombre'] },
    ],
  });
  const porId = new Map(productos.map((producto) => [producto.id, producto]));

  const items = filas.map((fila) => {
    const producto = porId.get(Number(fila.productoId));
    return {
      productoId: Number(fila.productoId),
      nombre: producto ? producto.nombre : fila.nombreHistorico,
      categoria:
        producto && producto.Categoria ? producto.Categoria.nombre : null,
      unidades: Number(fila.unidades || 0),
      facturacion: Number(fila.facturacion || 0),
    };
  });

  const masVendidos = [...items]
    .sort(
      (a, b) =>
        b.unidades - a.unidades ||
        b.facturacion - a.facturacion ||
        a.nombre.localeCompare(b.nombre, 'es')
    )
    .slice(0, LIMITE_PRODUCTOS);

  const mayorFacturacion = [...items]
    .sort(
      (a, b) =>
        b.facturacion - a.facturacion ||
        b.unidades - a.unidades ||
        a.nombre.localeCompare(b.nombre, 'es')
    )
    .slice(0, LIMITE_PRODUCTOS);

  const menosVendido =
    [...items].sort(
      (a, b) =>
        a.unidades - b.unidades ||
        a.facturacion - b.facturacion ||
        a.nombre.localeCompare(b.nombre, 'es')
    )[0] || null;

  return { masVendidos, mayorFacturacion, menosVendido };
}

async function armarStock(sucursalId) {
  const umbral = await obtenerValor(CLAVE_UMBRAL_STOCK);
  const filas = await Stock.findAll({
    where: sucursalId ? { sucursalId } : {},
    include: [
      {
        model: Producto,
        as: 'Producto',
        attributes: ['id', 'nombre'],
        required: true,
        where: { activo: true },
      },
      {
        model: Sucursal,
        as: 'Sucursal',
        attributes: ['id', 'nombre'],
        required: true,
        ...(sucursalId ? {} : { where: { activa: true } }),
      },
    ],
    order: [
      [{ model: Sucursal, as: 'Sucursal' }, 'nombre', 'ASC'],
      [{ model: Producto, as: 'Producto' }, 'nombre', 'ASC'],
    ],
  });

  const sinStock = [];
  const critico = [];
  filas.forEach((fila) => {
    const item = {
      sucursalId: fila.sucursalId,
      sucursal: fila.Sucursal ? fila.Sucursal.nombre : null,
      productoId: fila.productoId,
      producto: fila.Producto ? fila.Producto.nombre : null,
      cantidad: fila.cantidad,
      disponible: fila.disponible,
    };
    if (!fila.disponible || fila.cantidad <= 0) {
      sinStock.push(item);
    } else if (umbral > 0 && fila.cantidad <= umbral) {
      critico.push(item);
    }
  });

  return { umbralCritico: umbral > 0 ? umbral : null, sinStock, critico };
}

async function armarFranjaHoraria(periodo, sucursalId) {
  const horaLiteral = literal(
    `EXTRACT(HOUR FROM "fechaHora" AT TIME ZONE '${ZONA_HORARIA}')`
  );
  const filas = await Pedido.findAll({
    attributes: [
      [horaLiteral, 'hora'],
      [fn('COUNT', col('Pedido.id')), 'pedidos'],
    ],
    where: wherePedidos(periodo, sucursalId),
    group: [horaLiteral],
    raw: true,
  });
  const porHora = new Map(
    filas.map((fila) => [Number(fila.hora), Number(fila.pedidos)])
  );
  return Array.from({ length: 24 }, (_, hora) => ({
    hora,
    pedidos: porHora.get(hora) || 0,
  }));
}

async function armarPorDiaSemana(periodo, sucursalId) {
  const diaSemanaLiteral = literal(
    `EXTRACT(DOW FROM "fechaHora" AT TIME ZONE '${ZONA_HORARIA}')`
  );
  const filas = await Pedido.findAll({
    attributes: [
      [diaSemanaLiteral, 'dia'],
      [fn('COUNT', col('Pedido.id')), 'pedidos'],
    ],
    where: wherePedidos(periodo, sucursalId),
    group: [diaSemanaLiteral],
    raw: true,
  });
  const porDia = new Map(
    filas.map((fila) => [Number(fila.dia), Number(fila.pedidos)])
  );
  return Array.from({ length: 7 }, (_, dia) => ({
    dia,
    nombre: NOMBRES_DIA[dia],
    pedidos: porDia.get(dia) || 0,
  }));
}

async function armarCancelaciones(periodo, sucursalId, porSucursal) {
  const cancelado = await EstadoPedido.findOne({
    where: { nombre: 'cancelado' },
    attributes: ['id'],
  });
  const where = wherePedidos(periodo, sucursalId);
  const diaLiteral = literal(
    `to_char("fechaHora" AT TIME ZONE '${ZONA_HORARIA}', 'YYYY-MM-DD')`
  );
  const whereCancelado = cancelado
    ? { ...where, estadoId: cancelado.id }
    : { ...where, estadoId: -1 };

  const [cantidad, porDiaFilas, pedidosTotales] = await Promise.all([
    Pedido.count({ where: whereCancelado }),
    Pedido.findAll({
      attributes: [
        [diaLiteral, 'dia'],
        [fn('COUNT', col('Pedido.id')), 'cantidad'],
      ],
      where: whereCancelado,
      group: [diaLiteral],
      raw: true,
    }),
    Pedido.count({ where }),
  ]);

  return {
    cantidad,
    porcentaje: pedidosTotales
      ? Math.round((cantidad / pedidosTotales) * 1000) / 10
      : 0,
    pedidosTotales,
    porSucursal: porSucursal.map((fila) => ({
      sucursalId: fila.sucursalId,
      sucursal: fila.sucursal,
      cantidad: fila.cancelados,
      pedidos: fila.pedidos,
      porcentaje: fila.pedidos
        ? Math.round((fila.cancelados / fila.pedidos) * 1000) / 10
        : 0,
    })),
    porDia: porDiaFilas.map((fila) => ({
      dia: fila.dia,
      cantidad: Number(fila.cantidad),
    })),
  };
}

async function canceladosPorSucursal(periodo, sucursalId) {
  const cancelado = await EstadoPedido.findOne({
    where: { nombre: 'cancelado' },
    attributes: ['id'],
  });
  if (!cancelado) return [];
  const filas = await Pedido.findAll({
    attributes: [
      [col('Sucursal.id'), 'sucursalId'],
      [col('Sucursal.nombre'), 'sucursal'],
      [fn('COUNT', col('Pedido.id')), 'cancelados'],
    ],
    include: [{ model: Sucursal, attributes: [], required: true }],
    where: {
      ...wherePedidos(periodo, sucursalId),
      estadoId: cancelado.id,
    },
    group: [col('Sucursal.id'), col('Sucursal.nombre')],
    raw: true,
  });
  return filas.map((fila) => ({
    sucursalId: Number(fila.sucursalId),
    sucursal: fila.sucursal,
    cancelados: Number(fila.cancelados),
  }));
}

/**
 * Promociones: pedidos entregados que usaron al menos una promo, descuento
 * otorgado e importe de esos pedidos. La facturación por promo se calcula
 * sobre pedidos distintos para no duplicar cuando un pedido aplicó varias.
 */
async function armarPromociones(periodo, sucursalId) {
  const filtroSucursal = sucursalId ? 'AND p."sucursalId" = :sucursalId' : '';
  const replacements = {
    desde: periodo.desde,
    hasta: periodo.hastaExclusivo,
    ...(sucursalId ? { sucursalId } : {}),
  };

  const [global] = await db.sequelize.query(
    `SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(total), 0) AS facturacion
       FROM (
         SELECT DISTINCT p.id, p.total
           FROM "Pedidos" p
           JOIN "PedidoPromociones" pp ON pp."pedidoId" = p.id
           JOIN "EstadoPedidos" e ON e.id = p."estadoId"
          WHERE e.nombre = '${ESTADO_VENTA}'
            AND p."fechaHora" >= :desde
            AND p."fechaHora" < :hasta
            ${filtroSucursal}
       ) t`,
    { replacements, type: QueryTypes.SELECT }
  );

  const porPromoFilas = await db.sequelize.query(
    `SELECT "promocionId", COUNT(*)::int AS pedidos, COALESCE(SUM(total), 0) AS facturacion
       FROM (
         SELECT DISTINCT pp."promocionId", p.id, p.total
           FROM "PedidoPromociones" pp
           JOIN "Pedidos" p ON p.id = pp."pedidoId"
           JOIN "EstadoPedidos" e ON e.id = p."estadoId"
          WHERE e.nombre = '${ESTADO_VENTA}'
            AND p."fechaHora" >= :desde
            AND p."fechaHora" < :hasta
            ${filtroSucursal}
       ) t
      GROUP BY "promocionId"`,
    { replacements, type: QueryTypes.SELECT }
  );

  const descuentos = await PedidoPromocion.findAll({
    attributes: [
      'promocionId',
      [fn('COUNT', fn('DISTINCT', col('PedidoPromocion.pedidoId'))), 'pedidos'],
      [fn('SUM', col('PedidoPromocion.descuentoAplicado')), 'descuento'],
    ],
    include: [
      {
        model: Pedido,
        attributes: [],
        required: true,
        where: wherePedidos(periodo, sucursalId),
        include: includeEntregado(),
      },
    ],
    group: ['PedidoPromocion.promocionId'],
    raw: true,
  });

  const [descuentoTotal] = await db.sequelize.query(
    `SELECT COALESCE(SUM(pp."descuentoAplicado"), 0) AS descuento
       FROM "PedidoPromociones" pp
       JOIN "Pedidos" p ON p.id = pp."pedidoId"
       JOIN "EstadoPedidos" e ON e.id = p."estadoId"
      WHERE e.nombre = '${ESTADO_VENTA}'
        AND p."fechaHora" >= :desde
        AND p."fechaHora" < :hasta
        ${filtroSucursal}`,
    { replacements, type: QueryTypes.SELECT }
  );

  const promociones = await Promocion.findAll({
    attributes: ['id', 'nombre'],
  });
  const porId = new Map(promociones.map((promo) => [promo.id, promo.nombre]));
  const descuentoPorId = new Map(
    descuentos.map((fila) => [Number(fila.promocionId), fila])
  );

  const porPromocion = porPromoFilas.map((fila) => {
    const id = Number(fila.promocionId);
    const descuento = descuentoPorId.get(id);
    return {
      promocionId: id,
      nombre: porId.get(id) || `Promoción ${id}`,
      pedidos: Number(fila.pedidos),
      descuento: descuento ? Number(descuento.descuento || 0) : 0,
      facturacion: Number(fila.facturacion || 0),
    };
  });

  porPromocion.sort(
    (a, b) => b.facturacion - a.facturacion || b.pedidos - a.pedidos
  );

  return {
    pedidosConPromocion: Number(global.pedidos || 0),
    facturacionConPromocion: Number(global.facturacion || 0),
    descuentoTotal: Number(descuentoTotal.descuento || 0),
    porPromocion,
  };
}

async function armarClientes(periodo, sucursalId) {
  const filtroSucursal = sucursalId ? 'AND p."sucursalId" = :sucursalId' : '';
  const replacements = {
    desde: periodo.desde,
    hasta: periodo.hastaExclusivo,
    ...(sucursalId ? { sucursalId } : {}),
  };

  const [resumenFilas, recurrentesFilas, topFilas] = await Promise.all([
    db.sequelize.query(
      `SELECT COUNT(DISTINCT p."usuarioId")::int AS clientes,
              COALESCE(SUM(p.total), 0) AS facturacion
         FROM "Pedidos" p
         JOIN "EstadoPedidos" e ON e.id = p."estadoId"
        WHERE e.nombre = '${ESTADO_VENTA}'
          AND p."fechaHora" >= :desde
          AND p."fechaHora" < :hasta
          ${filtroSucursal}`,
      { replacements, type: QueryTypes.SELECT }
    ),
    db.sequelize.query(
      `SELECT COUNT(*)::int AS recurrentes
         FROM (
           SELECT p."usuarioId"
             FROM "Pedidos" p
             JOIN "EstadoPedidos" e ON e.id = p."estadoId"
            WHERE e.nombre = '${ESTADO_VENTA}'
              AND p."fechaHora" >= :desde
              AND p."fechaHora" < :hasta
              ${filtroSucursal}
            GROUP BY p."usuarioId"
           HAVING COUNT(*) >= 2
         ) t`,
      { replacements, type: QueryTypes.SELECT }
    ),
    db.sequelize.query(
      `SELECT p."usuarioId", COUNT(*)::int AS pedidos,
              COALESCE(SUM(p.total), 0) AS facturacion
         FROM "Pedidos" p
         JOIN "EstadoPedidos" e ON e.id = p."estadoId"
        WHERE e.nombre = '${ESTADO_VENTA}'
          AND p."fechaHora" >= :desde
          AND p."fechaHora" < :hasta
          ${filtroSucursal}
        GROUP BY p."usuarioId"
        ORDER BY facturacion DESC, pedidos DESC
        LIMIT ${LIMITE_CLIENTES}`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const resumen = resumenFilas[0] || { clientes: 0, facturacion: 0 };
  const usuarios = topFilas.length
    ? await Usuario.findAll({
        where: { id: topFilas.map((fila) => Number(fila.usuarioId)) },
        attributes: ['id', 'nombre', 'apellido', 'email'],
      })
    : [];
  const porId = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

  const nuevos = await Usuario.count({
    where: {
      rol: 'CLIENTE',
      createdAt: {
        [Op.gte]: periodo.desde,
        [Op.lt]: periodo.hastaExclusivo,
      },
    },
  });

  const clientes = Number(resumen.clientes || 0);
  const facturacion = Number(resumen.facturacion || 0);

  return {
    nuevos,
    conPedidos: clientes,
    recurrentes: Number(
      (recurrentesFilas[0] && recurrentesFilas[0].recurrentes) || 0
    ),
    ticketPromedio: promedio(facturacion, clientes),
    top: topFilas.map((fila) => {
      const usuario = porId.get(Number(fila.usuarioId));
      return {
        usuarioId: Number(fila.usuarioId),
        nombre: usuario
          ? `${usuario.nombre} ${usuario.apellido || ''}`.trim()
          : `Cliente ${fila.usuarioId}`,
        email: usuario ? usuario.email : null,
        pedidos: Number(fila.pedidos),
        facturacion: Number(fila.facturacion || 0),
      };
    }),
  };
}

/**
 * Reporte completo del período.
 *
 * @param {object} opciones
 * @param {object} opciones.periodo - resultado de `validarPeriodo`.
 * @param {number|null} opciones.sucursalId - alcance resuelto por el controller.
 * @returns {Promise<object>}
 */
export async function obtenerReportes({ periodo, sucursalId = null }) {
  if (sucursalId) {
    const sucursal = await Sucursal.findByPk(sucursalId, {
      attributes: ['id', 'nombre'],
    });
    if (!sucursal) throw new SucursalInexistenteError(sucursalId);
  }

  const [
    resumen,
    porDia,
    porEstado,
    porSucursal,
    productos,
    stock,
    franjaHoraria,
    porDiaSemana,
    canceladosSucursal,
    promociones,
    clientes,
  ] = await Promise.all([
    armarResumen(periodo, sucursalId),
    armarPorDia(periodo, sucursalId),
    armarPorEstado(periodo, sucursalId),
    armarPorSucursal(periodo, sucursalId),
    armarRankingProductos(periodo, sucursalId),
    armarStock(sucursalId),
    armarFranjaHoraria(periodo, sucursalId),
    armarPorDiaSemana(periodo, sucursalId),
    canceladosPorSucursal(periodo, sucursalId),
    armarPromociones(periodo, sucursalId),
    armarClientes(periodo, sucursalId),
  ]);

  const porSucursalConCancelados = porSucursal.map((fila) => {
    const cancelados = canceladosSucursal.find(
      (item) => item.sucursalId === fila.sucursalId
    );
    return {
      ...fila,
      cancelados: cancelados ? cancelados.cancelados : 0,
    };
  });

  const cancelaciones = await armarCancelaciones(
    periodo,
    sucursalId,
    porSucursalConCancelados
  );

  return {
    periodo: {
      desde: periodo.desdeClave,
      hasta: periodo.hastaClave,
      sucursalId,
      sucursal:
        porSucursal.find((fila) => fila.sucursalId === sucursalId)?.sucursal ||
        null,
    },
    resumen,
    porDia,
    porEstado,
    porSucursal: porSucursalConCancelados,
    productos,
    stock,
    franjaHoraria,
    porDiaSemana,
    cancelaciones,
    promociones,
    clientes,
  };
}

export default { obtenerReportes, validarPeriodo };
