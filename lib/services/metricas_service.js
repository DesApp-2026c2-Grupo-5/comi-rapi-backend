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
 * Único estado que cuenta como venta/facturación en todo el sistema: un pedido
 * `entregado`. El resto de los estados no suma ingresos.
 */
const ESTADO_VENTA = 'entregado';

/** Include que restringe las consultas a pedidos entregados. */
const includeVenta = {
  model: EstadoPedido,
  as: 'estadoActual',
  attributes: [],
  required: true,
  where: { nombre: ESTADO_VENTA },
};

/** Días que muestra la serie de pedidos por día. */
const DIAS_SERIE = 30;

/** Empieza la serie de `DIAS_SERIE` días atrás, a la medianoche local. */
function inicioDeSerie() {
  const desde = new Date();
  desde.setDate(desde.getDate() - (DIAS_SERIE - 1));
  desde.setHours(0, 0, 0, 0);
  return desde;
}

/**
 * Pedidos agregados: total, vendidos (entregados) e ingresos. El COUNT total
 * incluye todos los estados; el COUNT/SUM de ventas solo `entregado`.
 */
async function resumenDePedidos() {
  const [total, vendidos, ingresos] = await Promise.all([
    Pedido.count(),
    Pedido.count({ include: [includeVenta] }),
    Pedido.sum('total', { include: [includeVenta] }),
  ]);

  return {
    total,
    vendidos,
    ingresos: ingresos === null ? 0 : Number(ingresos),
  };
}

/**
 * Pedidos por estado. `cantidad` cuenta todo; `ingresos` solo suma el estado
 * `entregado` (0 para el resto).
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
    ingresos:
      fila.estado === ESTADO_VENTA && fila.ingresos !== null
        ? Number(fila.ingresos)
        : 0,
  }));
}

/**
 * Ventas por sucursal activa. Se agrega sobre `Pedidos` (N a 1 con Sucursal) y
 * se completa con las sucursales sin ventas en 0, para que el panel siempre
 * liste todos los locales activos.
 */
async function pedidosPorSucursal() {
  const sucursales = await Sucursal.findAll({
    where: { activa: true },
    attributes: ['id', 'nombre'],
    order: [['nombre', 'ASC']],
  });

  const agregados = await Pedido.findAll({
    attributes: [
      [col('Sucursal.id'), 'sucursalId'],
      [fn('COUNT', col('Pedido.id')), 'cantidad'],
      [fn('SUM', col('Pedido.total')), 'ingresos'],
    ],
    include: [
      includeVenta,
      { model: Sucursal, attributes: [], required: true },
    ],
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
 * Serie de pedidos por día (últimos `DIAS_SERIE` días), solo entregados. El día
 * se arma con la fecha local del servidor, igual que el resto del sistema
 * (`fechaHora` se guarda como NOW() sin zona).
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
    include: [includeVenta],
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
