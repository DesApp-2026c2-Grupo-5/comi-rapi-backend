import { cleanDb, crearUsuario } from '../../test/db_utils';
import db from '../models';
import {
  cancelarPedidosVencidos,
  expiracionReserva,
  OBSERVACION_CANCELACION_RESERVA,
  reservaVencida,
  segundosRestantesReserva,
} from './reserva_pedidos';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoEstadoHistorial,
  PedidoItem,
  Producto,
  Stock,
  Sucursal,
} = db;

const MINUTO = 60 * 1000;

// Cálculo del plazo: no depende de la base, así que se prueba solo.
describe('expiracionReserva', () => {
  test('suma el plazo a la fecha de creación del pedido', () => {
    const creado = new Date('2026-11-09T10:00:00.000Z');
    expect(expiracionReserva({ fechaHora: creado }, 15).toISOString()).toBe(
      '2026-11-09T10:15:00.000Z'
    );
  });

  test('acepta la fecha como string ISO (lo que devuelve la API)', () => {
    expect(
      expiracionReserva(
        { fechaHora: '2026-11-09T10:00:00.000Z' },
        5
      ).toISOString()
    ).toBe('2026-11-09T10:05:00.000Z');
  });

  test('devuelve null si la fecha no es válida', () => {
    expect(expiracionReserva({ fechaHora: null }, 15)).toBeNull();
    expect(expiracionReserva({ fechaHora: 'no-es-fecha' }, 15)).toBeNull();
    expect(expiracionReserva({}, 15)).toBeNull();
    expect(expiracionReserva(null, 15)).toBeNull();
  });
});

describe('reservaVencida', () => {
  const creado = new Date('2026-11-09T10:00:00.000Z');

  test('no vence antes del límite y sí al alcanzarlo', () => {
    expect(
      reservaVencida(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T10:14:59.000Z')
      )
    ).toBe(false);
    expect(
      reservaVencida(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T10:15:00.000Z')
      )
    ).toBe(true);
    expect(
      reservaVencida(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T10:20:00.000Z')
      )
    ).toBe(true);
  });

  test('sin fecha válida no se considera vencida (degradación segura)', () => {
    expect(reservaVencida({}, 15, new Date())).toBe(false);
  });
});

describe('segundosRestantesReserva', () => {
  const creado = new Date('2026-11-09T10:00:00.000Z');

  test('informa los segundos que faltan, redondeando para arriba', () => {
    expect(
      segundosRestantesReserva(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T10:00:00.000Z')
      )
    ).toBe(900);
    expect(
      segundosRestantesReserva(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T10:14:59.400Z')
      )
    ).toBe(1);
  });

  test('nunca devuelve negativos', () => {
    expect(
      segundosRestantesReserva(
        { fechaHora: creado },
        15,
        new Date('2026-11-09T11:00:00.000Z')
      )
    ).toBe(0);
    expect(segundosRestantesReserva({}, 15, new Date())).toBe(0);
  });
});

describe('cancelarPedidosVencidos (contra la base)', () => {
  let sucursal;
  let producto;
  let cliente;
  let pendiente;
  let confirmado;
  let cancelado;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Reservas',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Empanada de reserva',
      precio: 1000,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Reservas' });
    await Stock.create({
      sucursalId: sucursal.id,
      productoId: producto.id,
      cantidad: 10,
      disponible: true,
    });
    const estados = await EstadoPedido.bulkCreate([
      { nombre: 'pendiente', orden: 1, esInicial: true },
      { nombre: 'confirmado', orden: 2 },
      { nombre: 'cancelado', orden: 7, esFinal: true },
    ]);
    pendiente = estados.find((e) => e.nombre === 'pendiente');
    confirmado = estados.find((e) => e.nombre === 'confirmado');
    cancelado = estados.find((e) => e.nombre === 'cancelado');
    cliente = await crearUsuario({
      email: 'cliente-reservas@test.com',
      nombre: 'Cliente',
      apellido: 'Reservas',
    });
  });

  // Cada test arranca con el stock lleno: el estado de una prueba no influye en
  // la siguiente.
  beforeEach(async () => {
    await PedidoEstadoHistorial.destroy({ where: {} });
    await PedidoItem.destroy({ where: {} });
    await Pedido.destroy({ where: {} });
    await Stock.update(
      { cantidad: 10 },
      { where: { sucursalId: sucursal.id, productoId: producto.id } }
    );
  });

  /**
   * Crea un pedido PENDIENTE con su línea y simula la reserva: el stock queda
   * descontado, igual que hace `POST /api/pedidos`.
   */
  const crearPedidoPendiente = async ({ fechaHora, cantidad = 1, estado }) => {
    const pedido = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursal.id,
      estadoId: (estado || pendiente).id,
      total: 1000 * cantidad,
      fechaHora,
      calle: 'Av. Reservas',
      altura: 100,
      latitud: -34.6037,
      longitud: -58.3816,
    });
    await PedidoItem.create({
      pedidoId: pedido.id,
      productoId: producto.id,
      nombreProducto: producto.nombre,
      precioUnitario: 1000,
      cantidad,
      subtotal: 1000 * cantidad,
    });
    await Stock.decrement('cantidad', {
      by: cantidad,
      where: { sucursalId: sucursal.id, productoId: producto.id },
    });
    return pedido;
  };

  const cantidadEnStock = async () => {
    const fila = await Stock.findOne({
      where: { sucursalId: sucursal.id, productoId: producto.id },
    });
    return Number(fila.cantidad);
  };

  test('cancela el pendiente vencido y repone su stock', async () => {
    const ahora = new Date('2026-11-09T12:00:00.000Z');
    const vencido = await crearPedidoPendiente({
      fechaHora: new Date(ahora.getTime() - 16 * MINUTO),
      cantidad: 2,
    });
    const reciente = await crearPedidoPendiente({
      fechaHora: new Date(ahora.getTime() - 2 * MINUTO),
      cantidad: 1,
    });
    // 10 - 2 (vencido) - 1 (reciente) = 7 reservadas.
    expect(await cantidadEnStock()).toBe(7);

    const cancelados = await cancelarPedidosVencidos({ ahora });

    expect(cancelados).toHaveLength(1);
    expect(cancelados[0].pedidoId).toBe(Number(vencido.id));
    expect(cancelados[0].sucursalId).toBe(Number(sucursal.id));
    // Solo vuelven las 2 unidades del pedido vencido.
    expect(await cantidadEnStock()).toBe(9);

    const actualizado = await Pedido.findByPk(vencido.id);
    expect(Number(actualizado.estadoId)).toBe(Number(cancelado.id));

    // El historial no tiene usuario: la decisión es del sistema.
    const historial = await PedidoEstadoHistorial.findOne({
      where: { pedidoId: vencido.id, estadoId: cancelado.id },
    });
    expect(historial).not.toBeNull();
    expect(historial.usuarioId).toBeNull();
    expect(historial.observacion).toBe(OBSERVACION_CANCELACION_RESERVA);

    // El pedido reciente sigue pendiente, con su stock reservado.
    const fresco = await Pedido.findByPk(reciente.id);
    expect(Number(fresco.estadoId)).toBe(Number(pendiente.id));
  });

  test('respeta el plazo recibido en vez del parámetro global', async () => {
    const ahora = new Date('2026-11-09T12:00:00.000Z');
    const pedido = await crearPedidoPendiente({
      fechaHora: new Date(ahora.getTime() - 6 * MINUTO),
    });

    // Con un plazo de 30 minutos todavía está en término.
    expect(await cancelarPedidosVencidos({ ahora, minutos: 30 })).toHaveLength(
      0
    );
    expect(await cantidadEnStock()).toBe(9);

    // Con 5 minutos ya venció.
    const cancelados = await cancelarPedidosVencidos({ ahora, minutos: 5 });
    expect(cancelados).toHaveLength(1);
    expect(cancelados[0].pedidoId).toBe(Number(pedido.id));
    expect(await cantidadEnStock()).toBe(10);
  });

  test('no toca pedidos que ya fueron pagados', async () => {
    const ahora = new Date('2026-11-09T12:00:00.000Z');
    const pagado = await crearPedidoPendiente({
      fechaHora: new Date(ahora.getTime() - 40 * MINUTO),
      estado: confirmado,
    });

    expect(await cancelarPedidosVencidos({ ahora })).toHaveLength(0);

    const actualizado = await Pedido.findByPk(pagado.id);
    expect(Number(actualizado.estadoId)).toBe(Number(confirmado.id));
    // El stock sigue reservado por el pedido pagado.
    expect(await cantidadEnStock()).toBe(9);
  });
});
