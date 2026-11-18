import db from '../models';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import {
  ESTADOS_PEDIDO_CUPON,
  liberarCuponDePedido,
  RESULTADOS_LIBERACION,
} from './cupon_uso';

const { CuponEmision, Cupon, EstadoPedido, Pedido, PedidoCupon, Sucursal } = db;

const AHORA = new Date('2026-11-12T12:00:00.000Z');

const crearEscenario = async (extraPedido = {}, extraUso = {}) => {
  const sucursal = await Sucursal.create({ nombre: 'Sucursal Cupon Uso' });
  const [pendiente] = await EstadoPedido.bulkCreate([
    { nombre: 'pendiente', orden: 1, esInicial: true },
  ]);
  const cliente = await crearUsuario({
    nombre: 'Cliente Uso',
    email: 'cliente-uso@test.com',
  });
  const emision = await CuponEmision.create({
    creadaPorUsuarioId: cliente.id,
    nombre: 'Emision Uso',
    tipoDescuento: 'PORCENTAJE',
    valorDescuento: 10,
    compraMinima: 0,
    fechaInicio: new Date(AHORA.getTime() - 24 * 60 * 60 * 1000),
    fechaFin: new Date(AHORA.getTime() + 30 * 24 * 60 * 60 * 1000),
    configuracionSnapshot: { nombre: 'Emision Uso' },
  });
  const cupon = await Cupon.create({
    emisionId: emision.id,
    usuarioId: cliente.id,
    codigo: 'CR-TEST01',
    tipoDescuento: 'PORCENTAJE',
    valorDescuento: 10,
    compraMinima: 0,
    descuentoMaximo: null,
    fechaInicio: new Date(AHORA.getTime() - 24 * 60 * 60 * 1000),
    fechaFin: new Date(AHORA.getTime() + 30 * 24 * 60 * 60 * 1000),
    usosPermitidos: 1,
    activo: true,
    estadoEnvio: 'ENVIADO',
    enviadoEn: AHORA,
    alcanceSnapshot: { global: true },
  });
  const pedido = await Pedido.create({
    usuarioId: cliente.id,
    sucursalId: sucursal.id,
    estadoId: pendiente.id,
    fechaHora: AHORA,
    total: 1000,
    costoEnvio: 0,
    ...extraPedido,
  });
  const uso = await PedidoCupon.create({
    pedidoId: pedido.id,
    cuponId: cupon.id,
    usuarioId: cliente.id,
    codigo: cupon.codigo,
    tipoDescuento: cupon.tipoDescuento,
    valorDescuento: cupon.valorDescuento,
    compraMinima: cupon.compraMinima,
    baseCalculo: 1000,
    descuentoAplicado: 100,
    estado: ESTADOS_PEDIDO_CUPON.RESERVADO,
    reservadoEn: AHORA,
    ...extraUso,
  });
  return { pedido, uso, cupon };
};

describe('liberarCuponDePedido (concurrencia)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('dos liberaciones simultáneas del mismo pedido: una gana, la otra devuelve YA_LIBERADO', async () => {
    const { pedido } = await crearEscenario();

    const resultados = await Promise.allSettled([
      liberarCuponDePedido(pedido.id, { ahora: AHORA }),
      liberarCuponDePedido(pedido.id, { ahora: AHORA }),
    ]);

    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    expect(exitosas).toHaveLength(2);

    const valores = exitosas.map((r) => r.value);
    const liberadas = valores.filter(
      (v) => v.motivo === RESULTADOS_LIBERACION.LIBERADO
    );
    const yaLiberadas = valores.filter(
      (v) => v.motivo === RESULTADOS_LIBERACION.YA_LIBERADO
    );

    expect(liberadas).toHaveLength(1);
    expect(yaLiberadas).toHaveLength(1);

    const fila = await PedidoCupon.findOne({ where: { pedidoId: pedido.id } });
    expect(fila.estado).toBe(ESTADOS_PEDIDO_CUPON.LIBERADO);
    expect(fila.liberadoEn).not.toBeNull();
  });
});

describe('liberarCuponDePedido (cupón confirmado no se libera)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('un cupón CONFIRMADO no se libera al cancelar el pedido: devuelve NO_RESERVADO', async () => {
    const { pedido, uso } = await crearEscenario();
    // Forzar el uso a CONFIRMADO (simula pago confirmado)
    await uso.update({
      estado: ESTADOS_PEDIDO_CUPON.CONFIRMADO,
      confirmadoEn: AHORA,
    });

    const resultado = await liberarCuponDePedido(pedido.id, { ahora: AHORA });

    expect(resultado.liberado).toBe(false);
    expect(resultado.motivo).toBe(RESULTADOS_LIBERACION.NO_RESERVADO);

    // Verificar que el estado no cambió
    const fila = await db.PedidoCupon.findOne({
      where: { pedidoId: pedido.id },
    });
    expect(fila.estado).toBe(ESTADOS_PEDIDO_CUPON.CONFIRMADO);
    expect(fila.liberadoEn).toBeNull();
  });

  test('un cupón RESERVADO se libera normalmente', async () => {
    const { pedido } = await crearEscenario();
    // uso queda en RESERVADO por defecto

    const resultado = await liberarCuponDePedido(pedido.id, { ahora: AHORA });

    expect(resultado.liberado).toBe(true);
    expect(resultado.motivo).toBe(RESULTADOS_LIBERACION.LIBERADO);

    const fila = await db.PedidoCupon.findOne({
      where: { pedidoId: pedido.id },
    });
    expect(fila.estado).toBe(ESTADOS_PEDIDO_CUPON.LIBERADO);
    expect(fila.liberadoEn).not.toBeNull();
  });
});
