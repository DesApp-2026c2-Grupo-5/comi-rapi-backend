/**
 * Service: métricas globales del panel de SUPERADMINISTRADOR.
 *
 * El SUPERADMINISTRADOR no maneja pedidos individuales (decisión de rol): su
 * panel trabaja con agregados (COUNT / SUM / GROUP BY) calculados en la base,
 * nunca listados ni uniones en memoria.
 */

import { fn, col, Op, literal } from 'sequelize';
import db from '../models';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  Producto,
  Promocion,
  Sucursal,
  Usuario,
} = db;

/**
 * Estados que no cuentan como venta: un pedido `pendiente` todavía no se pagó y
 * uno `cancelado` se deshizo. Ambos filtran los ingresos, no la cantidad total
 * de pedidos del panel.
 */
const NO_INGRESO = ['pendiente', 'cancelado'];

/** Días que muestra la serie de pedidos por día. */
const DIAS_SERIE = 30;

/** Empieza la serie de `DIAS_SERIE` días atrás, a la medianoche local. */
function inicioDeSerie() {
  const desde = new Date();
  desde.setDate(desde.getDate() - (DIAS_SERIE - 1));
  desde.setHours(0, 0, 0, 0);
  return desde;
}

async function idsDeEstadosConNombre(nombres) {
  const estados = await EstadoPedido.findAll({
    where: { nombre: nombres },
    attributes: ['id'],
  });
  return estados.map((estado) => estado.id);
}

/**
 * Pedidos agregados: total, vendidos (sin pendientes ni cancelados) e ingresos.
 * El SUM excluye cancelados/pendientes; el COUNT total no.
 */
async function resumenDePedidos() {
  const [noIngresoIds, pendienteIds] = await Promise.all([
    idsDeEstadosConNombre(NO_INGRESO),
    idsDeEstadosConNombre(['pendiente']),
  ]);
  const ventasWhere =
    noIngresoIds.length > 0 ? { estadoId: { [Op.notIn]: noIngresoIds } } : {};

  const [total, vendidos, ingresos, pendientes] = await Promise.all([
    Pedido.count(),
    Pedido.count({ where: ventasWhere }),
    Pedido.sum('total', { where: ventasWhere }),
    Pedido.count({ where: { estadoId: pendienteIds } }),
  ]);

  return {
    total,
    vendidos,
    pendientes,
    ingresos: ingresos === null ? 0 : Number(ingresos),
  };
}

/**
 * Pedidos por estado. `cantidad` cuenta todo; `ingresos` solo suma los estados
 * que efectivamente son una venta (0 para pendiente/cancelado).
 */
async function pedidosPorEstado() {
  const filas = await Pedido.findAll({
    attributes: [
      [col('estadoActual.nombre'), 'estado'],
      [fn('COUNT', col('Pedido.id')), 'cantidad'],
      [fn('SUM', col('Pedido.total')), 'ingresos'],
    ],
    include: [
      {
        model: EstadoPedido,
        as: 'estadoActual',
        attributes: [],
        required: true,
      },
    ],
    group: [col('estadoActual.nombre')],
    order: [[col('estadoActual.nombre'), 'ASC']],
    raw: true,
  });

  return filas.map((fila) => ({
    estado: fila.estado,
    cantidad: Number(fila.cantidad),
    ingresos: NO_INGRESO.includes(fila.estado)
      ? 0
      : fila.ingresos === null
      ? 0
      : Number(fila.ingresos),
  }));
}

/**
 * Ventas por sucursal activa. Se agrega sobre `Pedidos` (N a 1 con Sucursal) y
 * se completa con las sucursales sin ventas en 0, para que el panel siempre
 * liste todos los locales activos.
 */
async function pedidosPorSucursal() {
  const [noIngresoIds, sucursales] = await Promise.all([
    idsDeEstadosConNombre(NO_INGRESO),
    Sucursal.findAll({
      where: { activa: true },
      attributes: ['id', 'nombre'],
      order: [['nombre', 'ASC']],
    }),
  ]);
  const ventasWhere =
    noIngresoIds.length > 0 ? { estadoId: { [Op.notIn]: noIngresoIds } } : {};

  const agregados = await Pedido.findAll({
    attributes: [
      [col('Sucursal.id'), 'sucursalId'],
      [fn('COUNT', col('Pedido.id')), 'cantidad'],
      [fn('SUM', col('Pedido.total')), 'ingresos'],
    ],
    include: [{ model: Sucursal, attributes: [], required: true }],
    where: ventasWhere,
    group: [col('Sucursal.id')],
    raw: true,
  });

  const porId = new Map(
    agregados.map((fila) => [Number(fila.sucursalId), fila])
  );

  return sucursales.map((sucursal) => {
    const fila = porId.get(sucursal.id);
    return {
      sucursalId: sucursal.id,
      sucursal: sucursal.nombre,
      cantidad: fila ? Number(fila.cantidad) : 0,
      ingresos: fila && fila.ingresos !== null ? Number(fila.ingresos) : 0,
    };
  });
}

/**
 * Serie de pedidos por día (últimos `DIAS_SERIE` días), solo estados que son
 * ventas. El día se arma con la fecha local del servidor, igual que el resto
 * del sistema (`fechaHora` se guarda como NOW() sin zona).
 */
async function pedidosPorDia() {
  const desde = inicioDeSerie();
  const diaLiteral = literal('to_char("fechaHora", \'YYYY-MM-DD\')');
  const filas = await Pedido.findAll({
    attributes: [
      [diaLiteral, 'dia'],
      [fn('COUNT', col('Pedido.id')), 'cantidad'],
      [fn('SUM', col('Pedido.total')), 'ingresos'],
    ],
    include: [
      {
        model: EstadoPedido,
        as: 'estadoActual',
        attributes: [],
        required: true,
        where: { nombre: { [Op.notIn]: NO_INGRESO } },
      },
    ],
    where: { fechaHora: { [Op.gte]: desde } },
    group: [diaLiteral],
    order: [[diaLiteral, 'ASC']],
    raw: true,
  });

  return filas.map((fila) => ({
    dia: fila.dia,
    cantidad: Number(fila.cantidad),
    ingresos: fila.ingresos === null ? 0 : Number(fila.ingresos),
  }));
}

/** Cuenta del catálogo global y del plantel, para el panel. */
async function resumenDeOperacion() {
  const [
    categorias,
    productos,
    combos,
    promocionesActivas,
    sucursalesActivas,
    clientes,
    administradores,
  ] = await Promise.all([
    Categoria.count(),
    Producto.count({ where: { activo: true, tipo: 'PRODUCTO' } }),
    Producto.count({ where: { activo: true, tipo: 'COMBO' } }),
    Promocion.count({ where: { activa: true } }),
    Sucursal.count({ where: { activa: true } }),
    Usuario.count({ where: { rol: 'CLIENTE' } }),
    Usuario.count({ where: { rol: 'ADMINISTRADOR' } }),
  ]);

  return {
    categorias,
    productos,
    combos,
    promocionesActivas,
    sucursalesActivas,
    clientes,
    administradores,
  };
}

/**
 * Resumen agregado completo para el panel del SUPERADMINISTRADOR.
 *
 * @returns {Promise<object>} Corte de todo el negocio en un solo objeto.
 */
export async function obtenerResumen() {
  const [
    pedidos,
    porEstado,
    porSucursal,
    porDia,
    operacion,
  ] = await Promise.all([
    resumenDePedidos(),
    pedidosPorEstado(),
    pedidosPorSucursal(),
    pedidosPorDia(),
    resumenDeOperacion(),
  ]);

  return {
    pedidos,
    porEstado,
    porSucursal,
    porDia,
    operacion,
  };
}
