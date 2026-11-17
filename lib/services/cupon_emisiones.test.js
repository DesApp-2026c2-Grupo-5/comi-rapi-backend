import crypto from 'crypto';
import db from '../models';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import {
  previewDestinatarios,
  emitir,
  reenviarEmision,
  resolverAlcanceProductos,
  ESTADOS_EMISION,
  ESTADOS_ENVIO,
} from './cupon_emisiones';
import {
  derivarEstadoCupon,
  ESTADOS_CUPON,
  calcularDescuentoCupon,
} from './cupones';

const AHORA = new Date('2026-11-13T10:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

const datosEmisionBase = {
  nombre: 'Emision test',
  descripcion: 'Descripcion test',
  tipoDescuento: 'PORCENTAJE',
  valorDescuento: 15,
  compraMinima: 1000,
  descuentoMaximo: null,
  fechaInicio: new Date(AHORA.getTime() - DIA_MS).toISOString(),
  fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS).toISOString(),
  productoIds: [1, 2],
  categoriaIds: [3],
  maxDestinatarios: 10,
  periodoAnalisisDias: 60,
};

const crearEscenarioBasico = async () => {
  const [, estadoEntregado] = await db.EstadoPedido.bulkCreate([
    { nombre: 'pendiente', orden: 1, esInicial: true },
    { nombre: 'entregado', orden: 6, esFinal: true },
  ]);
  const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Test' });
  const organizador = await crearUsuario({
    nombre: 'Organizador',
    email: 'organizador@test.com',
    rol: 'SUPERADMINISTRADOR',
  });
  // Categorias: el escenario usa la 3 como alcance y la 4 para un producto
  // que queda fuera del alcance. `cleanDb` reinicia las secuencias, asi que
  // los IDs son deterministas.
  await db.Categoria.bulkCreate([
    { id: 1, nombre: 'Categoria 1' },
    { id: 2, nombre: 'Categoria 2' },
    { id: 3, nombre: 'Categoria 3' },
    { id: 4, nombre: 'Categoria 4' },
  ]);
  // Clientes con email valido
  const clientes = await Promise.all([
    crearUsuario({ nombre: 'Cliente A', email: 'cliente-a@test.com' }),
    crearUsuario({ nombre: 'Cliente B', email: 'cliente-b@test.com' }),
    crearUsuario({ nombre: 'Cliente C', email: 'cliente-c@test.com' }),
    // `email` es NOT NULL en Usuario: se usa un valor con formato inválido
    // para representar al cliente que no puede recibir el cupón.
    crearUsuario({ nombre: 'Cliente Sin Email', email: 'sin-email' }),
  ]);
  // Productos con IDs deterministas (cleanDb reinicia las secuencias).
  const productos = await db.Producto.bulkCreate([
    {
      id: 1,
      nombre: 'Producto 1',
      precio: 1000,
      categoriaId: 3,
      tipo: 'PRODUCTO',
      activo: true,
    },
    {
      id: 2,
      nombre: 'Producto 2',
      precio: 2000,
      categoriaId: 3,
      tipo: 'PRODUCTO',
      activo: true,
    },
    {
      id: 3,
      nombre: 'Combo Test',
      precio: 5000,
      categoriaId: 3,
      tipo: 'COMBO',
      activo: true,
    },
    {
      id: 4,
      nombre: 'Producto No Alcanzado',
      precio: 3000,
      categoriaId: 4,
      tipo: 'PRODUCTO',
      activo: true,
    },
  ]);
  // Pedidos entregados dentro del periodo
  const ahora = new Date();
  const pedido1 = await db.Pedido.create({
    usuarioId: clientes[0].id,
    sucursalId: sucursal.id,
    estadoId: estadoEntregado.id,
    fechaHora: new Date(ahora.getTime() - 10 * DIA_MS),
    total: 5000,
    costoEnvio: 200,
  });
  const pedido2 = await db.Pedido.create({
    usuarioId: clientes[0].id,
    sucursalId: sucursal.id,
    estadoId: estadoEntregado.id,
    fechaHora: new Date(ahora.getTime() - 5 * DIA_MS),
    total: 8000,
    costoEnvio: 200,
  });
  const pedido3 = await db.Pedido.create({
    usuarioId: clientes[1].id,
    sucursalId: sucursal.id,
    estadoId: estadoEntregado.id,
    fechaHora: new Date(ahora.getTime() - 20 * DIA_MS),
    total: 3000,
    costoEnvio: 200,
  });
  // Lineas de pedido (producto alcanzado)
  await db.PedidoItem.bulkCreate([
    {
      pedidoId: pedido1.id,
      productoId: productos[0].id,
      nombreProducto: 'Producto 1',
      precioUnitario: 1000,
      cantidad: 2,
      subtotal: 2000,
    },
    {
      pedidoId: pedido1.id,
      productoId: productos[1].id,
      nombreProducto: 'Producto 2',
      precioUnitario: 2000,
      cantidad: 1,
      subtotal: 2000,
    },
    {
      pedidoId: pedido2.id,
      productoId: productos[0].id,
      nombreProducto: 'Producto 1',
      precioUnitario: 1000,
      cantidad: 3,
      subtotal: 3000,
    },
    {
      pedidoId: pedido3.id,
      productoId: productos[1].id,
      nombreProducto: 'Producto 2',
      precioUnitario: 2000,
      cantidad: 1,
      subtotal: 2000,
    },
    // Combo no debe contar
    {
      pedidoId: pedido1.id,
      productoId: productos[2].id,
      nombreProducto: 'Combo Test',
      precioUnitario: 5000,
      cantidad: 1,
      subtotal: 5000,
    },
  ]);
  return {
    estadoEntregado,
    sucursal,
    organizador,
    clientes,
    productos,
    pedido1,
    pedido2,
    pedido3,
  };
};

describe('previewDestinatarios', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('calcula unidades por cliente, orden descendente y aplica maxDestinatarios', async () => {
    await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    expect(preview.total).toBeGreaterThan(0);
    expect(preview.destinatarios.length).toBeLessThanOrEqual(
      datosEmisionBase.maxDestinatarios
    );
    // Orden descendente por unidades
    for (let i = 1; i < preview.destinatarios.length; i += 1) {
      expect(preview.destinatarios[i - 1].unidades).toBeGreaterThanOrEqual(
        preview.destinatarios[i].unidades
      );
    }
    // Todos tienen email valido
    preview.destinatarios.forEach((d) => {
      expect(d.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });
    // previewToken y previewExpiraEn presentes
    expect(preview.previewToken).toBeDefined();
    expect(preview.previewExpiraEn).toBeDefined();
    expect(preview.creadoEn).toBeDefined();
    // Alcance resuelto excluye combos
    expect(preview.alcance.productoIdsResueltos).toContain(1);
    expect(preview.alcance.productoIdsResueltos).toContain(2);
    expect(preview.alcance.productoIdsResueltos).not.toContain(3); // combo excluido
  });

  test('retorna lista vacia cuando no hay productos alcanzados', async () => {
    await crearEscenarioBasico();
    const preview = await previewDestinatarios(
      { ...datosEmisionBase, productoIds: [999], categoriaIds: [999] },
      { ahora: AHORA }
    );
    expect(preview.destinatarios).toEqual([]);
    expect(preview.total).toBe(0);
  });
});

describe('emitir con previewToken firmado', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  // Mock de envío de email: en entorno de test no hay transporte SMTP, así que
  // se simula un envío exitoso para que las pruebas se enfoquen en la lógica de
  // emisión y no en la disponibilidad del servidor de correo.
  const mockEnviarEmail = async () => ({ enviado: true });
  const optsEmitir = (organizadorId) => ({
    usuarioId: organizadorId,
    ahora: AHORA,
    enviarEmail: mockEnviarEmail,
  });

  test('emite cupones para destinatarios aprobados del preview', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    const resultado = await emitir(
      {
        ...datosEmisionBase,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      optsEmitir(organizador.id)
    );

    expect(resultado.emision.id).toBeDefined();
    expect(resultado.emision.estado).toBe(ESTADOS_EMISION.COMPLETADA);
    expect(resultado.cupones.length).toBe(preview.destinatarios.length);
    expect(resultado.enviados).toBe(preview.destinatarios.length);
    expect(resultado.fallidos).toBe(0);

    // Cada cupón tiene emisionId vinculado y alcance congelado
    resultado.cupones.forEach((c) => {
      expect(c.emisionId).toBe(resultado.emision.id);
      expect(c.alcanceSnapshot.global).toBe(false);
      expect(c.alcanceSnapshot.productoIdsResueltos).toEqual(
        preview.alcance.productoIdsResueltos
      );
      expect(c.usosPermitidos).toBe(1);
      expect(c.estadoEnvio).toBe(ESTADOS_ENVIO.ENVIADO);
    });
  });

  test('rechaza previewToken ausente', async () => {
    const { organizador } = await crearEscenarioBasico();
    await expect(
      emitir(
        { ...datosEmisionBase, destinatariosIds: [1] },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'preview_requerido' });
  });

  test('rechaza previewToken con firma invalida (manipulado)', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });
    const tokenManipulado = preview.previewToken.replace(/.$/, 'x'); // Cambiar ultimo char de la firma

    await expect(
      emitir(
        {
          ...datosEmisionBase,
          destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
          previewToken: tokenManipulado,
          previewExpiraEn: preview.previewExpiraEn,
        },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'preview_token_invalido' });
  });

  test('rechaza previewToken vencido', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    await expect(
      emitir(
        {
          ...datosEmisionBase,
          destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
          previewToken: preview.previewToken,
          previewExpiraEn: new Date('2020-01-01T00:00:00.000Z').toISOString(), // Vencido
        },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'preview_expirado' });
  });

  test('rechaza cuando la configuracion no coincide con el token firmado', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    await expect(
      emitir(
        {
          ...datosEmisionBase,
          valorDescuento: 99, // Cambiado respecto al preview
          destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
          previewToken: preview.previewToken,
          previewExpiraEn: preview.previewExpiraEn,
        },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'configuracion_no_coincide' });
  });

  test('rechaza cuando los destinatarios no coinciden con el token firmado', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    // `destinatariosIds` forma parte del hash de configuración firmado, así
    // que alterarlo se detecta como `configuracion_no_coincide` antes de
    // llegar a la comparación de destinatarios (defensa en profundidad).
    await expect(
      emitir(
        {
          ...datosEmisionBase,
          destinatariosIds: [99999], // No coincide con el preview
          previewToken: preview.previewToken,
          previewExpiraEn: preview.previewExpiraEn,
        },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'configuracion_no_coincide' });
  });

  test('no genera codigos ni cupones nuevos en reenvio (solo PENDIENTE/FALLIDO)', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    const resultado = await emitir(
      {
        ...datosEmisionBase,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      optsEmitir(organizador.id)
    );

    // Forzar un cupon como FALLIDO
    const cuponFallido = resultado.cupones[0];
    await db.Cupon.update(
      { estadoEnvio: ESTADOS_ENVIO.FALLIDO, errorEnvio: 'Error de prueba' },
      { where: { id: cuponFallido.id } }
    );

    const reenvio = await reenviarEmision(resultado.emision.id, {
      ahora: AHORA,
      enviarEmail: mockEnviarEmail,
    });
    expect(reenvio.reenviados).toBe(1);
    expect(reenvio.fallidos).toBe(0);

    // Verificar que no se crearon cupones nuevos
    const cuponesDespues = await db.Cupon.count({
      where: { emisionId: resultado.emision.id },
    });
    expect(cuponesDespues).toBe(resultado.cupones.length);
  });

  test('no permite doble confirmacion con el mismo previewToken (token de un solo uso)', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    // Primera emisión: debe tener éxito.
    const resultado1 = await emitir(
      {
        ...datosEmisionBase,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      optsEmitir(organizador.id)
    );
    expect(resultado1.emision.id).toBeDefined();
    expect(resultado1.emision.estado).toBe(ESTADOS_EMISION.COMPLETADA);

    // Segunda emisión con el mismo token: debe fallar porque ya fue consumido.
    await expect(
      emitir(
        {
          ...datosEmisionBase,
          destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
          previewToken: preview.previewToken,
          previewExpiraEn: preview.previewExpiraEn,
        },
        optsEmitir(organizador.id)
      )
    ).rejects.toMatchObject({ motivo: 'preview_token_ya_usado' });

    // Verificar que solo existe una emisión.
    const emisiones = await db.CuponEmision.count({
      where: { nombre: datosEmisionBase.nombre },
    });
    expect(emisiones).toBe(1);

    // Verificar que no se duplicaron cupones.
    const cuponesDeEmision = await db.Cupon.count({
      where: { emisionId: resultado1.emision.id },
    });
    expect(cuponesDeEmision).toBe(preview.destinatarios.length);
  });

  test('verifica que el previewToken se marca como usado en la base de datos', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    const tokenHash = crypto
      .createHash('sha256')
      .update(preview.previewToken, 'utf8')
      .digest('hex');

    // Antes de emitir, el token no debe estar marcado como usado (o no existir).
    // Puede no existir si todavía no se creó el registro previo (solo se crea al emitir).

    await emitir(
      {
        ...datosEmisionBase,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      optsEmitir(organizador.id)
    );

    // Después de emitir, el token debe estar marcado como usado.
    const despues = await db.CuponPreviewToken.findOne({
      where: { tokenHash },
    });
    expect(despues).not.toBeNull();
    expect(despues.usado).toBe(true);
    expect(despues.usadoEn).not.toBeNull();
  });

  test('doble confirmacion concurrente con el mismo previewToken: una gana, la otra recibe 409', async () => {
    const { organizador } = await crearEscenarioBasico();
    const preview = await previewDestinatarios(datosEmisionBase, {
      ahora: AHORA,
    });

    const datosEmision = {
      ...datosEmisionBase,
      destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
      previewToken: preview.previewToken,
      previewExpiraEn: preview.previewExpiraEn,
    };

    const resultados = await Promise.allSettled([
      emitir(datosEmision, optsEmitir(organizador.id)),
      emitir(datosEmision, optsEmitir(organizador.id)),
    ]);

    const exitosos = resultados.filter((r) => r.status === 'fulfilled');
    const fallidos = resultados.filter((r) => r.status === 'rejected');

    // Exactamente una debe tener éxito.
    expect(exitosos).toHaveLength(1);
    // La otra debe fallar con 409 (ya sea por token ya usado o por emisión en proceso).
    expect(fallidos).toHaveLength(1);
    const error = fallidos[0].reason;
    expect(error.codigo).toBe(409);
    expect(['preview_token_ya_usado', 'emision_en_proceso']).toContain(
      error.motivo
    );

    // Verificar que solo existe una emisión.
    const emisiones = await db.CuponEmision.count({
      where: { nombre: datosEmisionBase.nombre },
    });
    expect(emisiones).toBe(1);

    // Verificar que no se duplicaron cupones.
    const cuponesDeEmision = await db.Cupon.count({
      where: { emisionId: exitosos[0].value.emision.id },
    });
    expect(cuponesDeEmision).toBe(preview.destinatarios.length);
  });
});

describe('datosEmisionBase y alcance', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('resolverAlcanceProductos excluye combos y dedupe producto/categoria', async () => {
    await crearEscenarioBasico();
    const alcance = await resolverAlcanceProductos({
      productoIds: [1, 2],
      categoriaIds: [3],
    });
    // Producto 3 es combo, debe excluirse
    expect(alcance.productoIdsResueltos).toContain(1);
    expect(alcance.productoIdsResueltos).toContain(2);
    expect(alcance.productoIdsResueltos).not.toContain(3);
    // No duplicados
    expect(new Set(alcance.productoIdsResueltos).size).toBe(
      alcance.productoIdsResueltos.length
    );
  });
});

describe('calcularDescuentoCupon con alcance', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('aplica descuento solo sobre productos alcanzados, excluye envio', async () => {
    const { organizador } = await crearEscenarioBasico();
    const emision = await db.CuponEmision.create({
      creadaPorUsuarioId: organizador.id,
      nombre: 'Emision alcance',
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 1000,
      fechaInicio: new Date(AHORA.getTime() - DIA_MS),
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      configuracionSnapshot: { nombre: 'Emision alcance' },
    });
    const cupon = await db.Cupon.create({
      emisionId: emision.id,
      usuarioId: organizador.id,
      codigo: 'CR-TEST01',
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 1000,
      fechaInicio: new Date(AHORA.getTime() - DIA_MS),
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      usosPermitidos: 1,
      activo: true,
      estadoEnvio: 'ENVIADO',
      alcanceSnapshot: {
        global: false,
        productoIdsResueltos: [1, 2],
        categoriaIds: [3],
        productoIds: [1, 2],
      },
    });

    // Lineas: producto 1 (alcanzado), producto 999 (no alcanzado), combo (no alcanzado)
    const lineas = [
      { productoId: 1, subtotal: 2000 },
      { productoId: 999, subtotal: 5000 }, // No alcanzado
    ];
    const descuentoPromocionesPorLinea = [
      { indice: 0, descuento: 200 },
      { indice: 1, descuento: 0 },
    ];

    const resultado = calcularDescuentoCupon({
      lineas,
      descuentoPromocionesPorLinea,
      cupon,
      ahora: AHORA,
    });

    // subtotalAlcanzado = 2000 (solo producto 1)
    // descuentoPromocionAlcanzado = 200
    // baseCalculo = 1800
    // descuento = 10% de 1800 = 180
    expect(resultado.subtotalAlcanzado).toBe(2000);
    expect(resultado.descuentoPromocionAlcanzado).toBe(200);
    expect(resultado.baseCalculo).toBe(1800);
    expect(resultado.descuentoAplicado).toBe(180);
  });

  test('rechaza 409 cuando no hay productos alcanzados en el carrito', async () => {
    const { organizador } = await crearEscenarioBasico();
    const emision = await db.CuponEmision.create({
      creadaPorUsuarioId: organizador.id,
      nombre: 'Emision alcance',
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 0,
      fechaInicio: new Date(AHORA.getTime() - DIA_MS),
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      configuracionSnapshot: { nombre: 'Emision alcance' },
    });
    const cupon = await db.Cupon.create({
      emisionId: emision.id,
      usuarioId: organizador.id,
      codigo: 'CR-TEST02',
      tipoDescuento: 'PORCENTAJE',
      valorDescuento: 10,
      compraMinima: 0,
      fechaInicio: new Date(AHORA.getTime() - DIA_MS),
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      usosPermitidos: 1,
      activo: true,
      estadoEnvio: 'ENVIADO',
      alcanceSnapshot: {
        global: false,
        productoIdsResueltos: [1, 2],
        categoriaIds: [3],
        productoIds: [1, 2],
      },
    });

    const lineas = [{ productoId: 999, subtotal: 5000 }]; // No alcanzado
    const descuentoPromocionesPorLinea = [{ indice: 0, descuento: 0 }];

    let error;
    try {
      calcularDescuentoCupon({
        lineas,
        descuentoPromocionesPorLinea,
        cupon,
        ahora: AHORA,
      });
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeUndefined();
    expect(error.motivo).toBe('cupon_no_aplica_a_carrito');
    expect(error.codigo).toBe(409);
  });
});

describe('derivarEstadoCupon con fecha futura (PROGRAMADO)', () => {
  test('cupon con fecha de inicio futura es PROGRAMADO', () => {
    const cupon = {
      activo: true,
      fechaInicio: new Date(AHORA.getTime() + DIA_MS), // Manana
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      usosPermitidos: 1,
    };
    expect(derivarEstadoCupon(cupon, { ahora: AHORA })).toBe(
      ESTADOS_CUPON.PROGRAMADO
    );
  });

  test('cupon vigente es DISPONIBLE', () => {
    const cupon = {
      activo: true,
      fechaInicio: new Date(AHORA.getTime() - DIA_MS),
      fechaFin: new Date(AHORA.getTime() + 30 * DIA_MS),
      usosPermitidos: 1,
    };
    expect(derivarEstadoCupon(cupon, { ahora: AHORA })).toBe(
      ESTADOS_CUPON.DISPONIBLE
    );
  });
});
