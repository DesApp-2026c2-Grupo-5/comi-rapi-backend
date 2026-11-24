/**
 * Pruebas focales de las tres funcionalidades incorporadas sobre el sistema
 * original de emisiones: tipos de cliente, compra mínima en unidades y envío
 * de cupones programados al activarse (una sola vez).
 */

import db from '../models';
import { cleanDb } from '../../test/db_utils';
import {
  previewDestinatarios,
  emitir,
  reenviarEmision,
  normalizarTiposCliente,
  normalizarMinUnidadesCompradas,
  clasificarTiposCliente,
  validarDatosEmision,
  ESTADOS_ENVIO,
  ESTADOS_EMISION,
} from './cupon_emisiones';
import { enviarCuponesProgramados } from './cupon_programados';
import { listarCuponesCliente } from './cupones';

const AHORA = new Date('2026-11-22T12:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PERIODO = 30;

const fechaHace = (dias) => new Date(AHORA.getTime() - dias * DIA_MS);
const fechaEn = (dias) => new Date(AHORA.getTime() + dias * DIA_MS);

const crearCliente = async (nombre, diasAlta) =>
  db.Usuario.create({
    nombre,
    apellido: 'Test',
    email: `${nombre.toLowerCase()}@test.com`,
    password: '123456',
    rol: 'CLIENTE',
    activo: true,
    createdAt: fechaHace(diasAlta),
    updatedAt: fechaHace(diasAlta),
  });

const crearEscenario = async () => {
  const estadoEntregado = await db.EstadoPedido.create({
    nombre: 'entregado',
    orden: 6,
    esFinal: true,
  });
  const estadoCancelado = await db.EstadoPedido.create({
    nombre: 'cancelado',
    orden: 7,
    esFinal: true,
  });
  const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Test' });
  const organizador = await db.Usuario.create({
    nombre: 'Organizador',
    apellido: 'Test',
    email: 'organizador@test.com',
    password: '123456',
    rol: 'SUPERADMINISTRADOR',
    activo: true,
  });
  const categoria = await db.Categoria.create({ nombre: 'Categoria Test' });
  const producto = await db.Producto.create({
    nombre: 'Producto Test',
    precio: 1000,
    categoriaId: categoria.id,
    tipo: 'PRODUCTO',
    activo: true,
  });

  // Alta dentro del período, sin compras -> NUEVO.
  const nuevo = await crearCliente('Nuevo', 5);
  // Alta antes del período, sin compras -> ACTIVO.
  const activo = await crearCliente('Activo', 90);
  // Compró antes del período, nunca dentro -> INACTIVO.
  const inactivo = await crearCliente('Inactivo', 120);
  // Compró dentro del período -> ACTIVO si hay tipos; comprador si no.
  const comprador = await crearCliente('Comprador', 90);
  const granComprador = await crearCliente('GranComprador', 90);
  // Sólo tiene un pedido CANCELADO del producto: no es compra realizada.
  const canceladoComprador = await crearCliente('CanceladoComprador', 120);
  // Compró antes del período y tiene un pedido cancelado dentro del período:
  // sigue siendo INACTIVO porque el cancelado no cuenta como compra reciente.
  const inactivoConCancelado = await crearCliente('InactivoConCancelado', 120);

  const crearPedido = async (
    usuario,
    dias,
    cantidad,
    estadoId = estadoEntregado.id,
    prod = producto
  ) => {
    const pedido = await db.Pedido.create({
      usuarioId: usuario.id,
      sucursalId: sucursal.id,
      estadoId,
      fechaHora: fechaHace(dias),
      total: cantidad * 1000,
      costoEnvio: 0,
    });
    await db.PedidoItem.create({
      pedidoId: pedido.id,
      productoId: prod.id,
      nombreProducto: prod.nombre,
      precioUnitario: 1000,
      cantidad,
      subtotal: cantidad * 1000,
    });
    return pedido;
  };

  await crearPedido(inactivo, 60, 4);
  await crearPedido(comprador, 5, 2);
  await crearPedido(granComprador, 3, 5);
  await crearPedido(canceladoComprador, 60, 9, estadoCancelado.id);
  await crearPedido(inactivoConCancelado, 60, 2);
  await crearPedido(inactivoConCancelado, 5, 7, estadoCancelado.id);

  return {
    categoria,
    producto,
    organizador,
    nuevo,
    activo,
    inactivo,
    comprador,
    granComprador,
    canceladoComprador,
    inactivoConCancelado,
    crearCliente,
    crearPedido,
  };
};

const datosBase = (extra = {}) => ({
  nombre: 'Emision pruebas',
  descripcion: 'Descripcion',
  tipoDescuento: 'PORCENTAJE',
  valorDescuento: 10,
  compraMinima: 0,
  descuentoMaximo: null,
  fechaInicio: fechaHace(1).toISOString(),
  fechaFin: fechaEn(30).toISOString(),
  productoIds: [],
  categoriaIds: [],
  maxDestinatarios: null,
  periodoAnalisisDias: DIAS_PERIODO,
  tiposCliente: ['ACTIVO'],
  ...extra,
});

describe('tipos de cliente y compra mínima en unidades', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('la validación HTTP exige al menos un tipo, acepta varios y pide el período', async () => {
    // `validarDatosEmision` compara contra el reloj real, no contra AHORA.
    const fechasFuturas = {
      fechaInicio: new Date(Date.now() + 2 * DIA_MS).toISOString(),
      fechaFin: new Date(Date.now() + 30 * DIA_MS).toISOString(),
      categoriaIds: [1],
    };
    expect(() =>
      validarDatosEmision(datosBase({ ...fechasFuturas, tiposCliente: [] }))
    ).toThrow(expect.objectContaining({ motivo: 'tipo_cliente_requerido' }));
    // NUEVO y ACTIVO no son excluyentes: la API puede recibir ambos.
    expect(() =>
      validarDatosEmision(
        datosBase({ ...fechasFuturas, tiposCliente: ['NUEVO', 'ACTIVO'] })
      )
    ).not.toThrow();
    expect(() =>
      validarDatosEmision(
        datosBase({ ...fechasFuturas, periodoAnalisisDias: null })
      )
    ).toThrow(
      expect.objectContaining({ motivo: 'periodo_requerido_para_tipos' })
    );
  });

  test('el orden por unidades del período se conserva con tipos marcados', async () => {
    const { categoria } = await crearEscenario();
    const preview = await previewDestinatarios(
      datosBase({
        categoriaIds: [categoria.id],
        tiposCliente: ['ACTIVO'],
        minUnidadesCompradas: 1,
      }),
      { ahora: AHORA }
    );

    expect(preview.destinatarios.map((d) => d.unidades)).toEqual([5, 2]);
    expect(preview.destinatarios.every((d) => d.tipoCliente === 'ACTIVO')).toBe(
      true
    );
  });

  test('NUEVO conserva su fecha de registro; ACTIVO depende de pedidos', async () => {
    const {
      categoria,
      crearCliente,
      crearPedido,
      nuevo,
      activo,
      inactivo,
    } = await crearEscenario();
    const nuevoComprador = await crearCliente('NuevoConPedido', 5);
    await crearPedido(nuevoComprador, 2, 3);

    const porTipo = async (tipo) => {
      const resultado = await previewDestinatarios(
        datosBase({ categoriaIds: [categoria.id], tiposCliente: [tipo] }),
        { ahora: AHORA }
      );
      return new Map(resultado.destinatarios.map((d) => [d.usuarioId, d]));
    };

    const nuevos = await porTipo('NUEVO');
    expect(nuevos.has(nuevo.id)).toBe(true);
    expect(nuevos.has(nuevoComprador.id)).toBe(true);
    // El criterio de NUEVO sigue siendo la fecha de alta, no la actividad.
    expect(nuevos.get(nuevo.id).tiposAplicables).toEqual(['NUEVO']);
    expect(nuevos.get(nuevoComprador.id).tiposAplicables).toEqual([
      'NUEVO',
      'ACTIVO',
    ]);

    const inactivos = await porTipo('INACTIVO');
    expect(inactivos.has(inactivo.id)).toBe(true);
    expect(inactivos.has(nuevo.id)).toBe(false);

    const activos = await porTipo('ACTIVO');
    // Sin pedidos en el período, registrar antes ya no alcanza para ACTIVO.
    expect(activos.has(activo.id)).toBe(false);
    expect(activos.has(inactivo.id)).toBe(false);
    expect(activos.has(nuevo.id)).toBe(false);
    expect(activos.get(nuevoComprador.id)).toMatchObject({
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['NUEVO', 'ACTIVO'],
    });
  });

  test('un usuario nuevo que compró mucho también entra al elegir ACTIVO', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const nuevoComprador = await crearCliente('NuevoComprador', 5);
    await crearPedido(nuevoComprador, 2, 8);

    const resultado = await previewDestinatarios(
      datosBase({
        categoriaIds: [categoria.id],
        tiposCliente: ['ACTIVO'],
        minUnidadesCompradas: 1,
      }),
      { ahora: AHORA }
    );
    const porId = new Map(resultado.destinatarios.map((d) => [d.usuarioId, d]));
    expect(porId.get(nuevoComprador.id)).toMatchObject({
      unidades: 8,
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['NUEVO', 'ACTIVO'],
    });
  });

  test('NUEVO y ACTIVO juntos no duplican destinatarios ni cupones', async () => {
    const {
      categoria,
      organizador,
      crearCliente,
      crearPedido,
      nuevo,
      activo,
    } = await crearEscenario();
    const nuevoComprador = await crearCliente('NuevoDoble', 5);
    await crearPedido(nuevoComprador, 2, 3);
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['NUEVO', 'ACTIVO'],
      fechaInicio: fechaEn(2).toISOString(),
    });
    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    const ids = preview.destinatarios.map((d) => d.usuarioId);

    expect(ids).toContain(nuevo.id);
    expect(ids).toContain(nuevoComprador.id);
    expect(ids).not.toContain(activo.id);
    expect(new Set(ids).size).toBe(ids.length);

    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: ids,
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      {
        usuarioId: organizador.id,
        ahora: AHORA,
        enviarEmail: async () => ({ enviado: true }),
      }
    );
    const cuponesIds = resultado.cupones.map((c) => c.usuarioId);
    expect(cuponesIds).toContain(nuevo.id);
    expect(cuponesIds.length).toBe(new Set(cuponesIds).size);
  });

  test('INACTIVO se calcula con el historial real y no cuenta cancelados', async () => {
    const {
      categoria,
      inactivo,
      canceladoComprador,
      inactivoConCancelado,
    } = await crearEscenario();
    const preview = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );

    const porId = new Map(preview.destinatarios.map((d) => [d.usuarioId, d]));

    // Entregado antes del período y sin compras dentro: INACTIVO.
    expect(porId.get(inactivo.id)).toMatchObject({
      unidadesPrevias: 4,
      unidades: 0,
      tipoCliente: 'INACTIVO',
    });
    // Su único pedido del producto fue cancelado: no es compra realizada.
    expect(porId.has(canceladoComprador.id)).toBe(false);
    // El pedido cancelado dentro del período no borra su condición de inactivo.
    expect(porId.get(inactivoConCancelado.id)).toMatchObject({
      unidadesPrevias: 2,
      unidades: 0,
      tipoCliente: 'INACTIVO',
    });
  });

  test('el mínimo de INACTIVO se mide sobre las compras históricas del cupón', async () => {
    const {
      categoria,
      inactivo,
      inactivoConCancelado,
    } = await crearEscenario();
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['INACTIVO'],
      minUnidadesCompradas: 3,
    });

    // El INACTIVO tiene 4 unidades previas y 0 dentro del período: el mínimo se
    // mide sobre el historial, así que sí entra.
    const conMinimo = await previewDestinatarios(datos, { ahora: AHORA });
    expect(conMinimo.destinatarios.map((d) => d.usuarioId)).toContain(
      inactivo.id
    );
    expect(
      conMinimo.destinatarios.find((d) => d.usuarioId === inactivo.id)
    ).toMatchObject({
      unidades: 0,
      unidadesPrevias: 4,
      unidadesHistoricas: 4,
      tipoCliente: 'INACTIVO',
    });
    // Quien sólo tiene 2 históricas no llega al mínimo de 3.
    expect(conMinimo.destinatarios.map((d) => d.usuarioId)).not.toContain(
      inactivoConCancelado.id
    );

    // Con 5 no alcanza sus 4 históricas.
    const exigente = await previewDestinatarios(
      { ...datos, minUnidadesCompradas: 5 },
      { ahora: AHORA }
    );
    expect(exigente.destinatarios.map((d) => d.usuarioId)).not.toContain(
      inactivo.id
    );

    // Con ACTIVO el mismo mínimo sí lo excluye: no compró en el período.
    const activos = await previewDestinatarios(
      { ...datos, tiposCliente: ['ACTIVO'] },
      { ahora: AHORA }
    );
    expect(activos.destinatarios.map((d) => d.usuarioId)).not.toContain(
      inactivo.id
    );
  });

  test('el mínimo de ACTIVO usa sólo unidades del período y la emisión respeta el preview', async () => {
    const {
      categoria,
      organizador,
      comprador,
      granComprador,
      inactivo,
    } = await crearEscenario();
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['ACTIVO'],
      minUnidadesCompradas: 3,
    });

    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    const ids = preview.destinatarios.map((d) => d.usuarioId);
    expect(ids).toEqual([granComprador.id]);
    expect(preview.destinatarios[0]).toMatchObject({
      unidades: 5,
      unidadesPrevias: 0,
      unidadesHistoricas: 5,
    });

    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: ids,
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      {
        usuarioId: organizador.id,
        ahora: AHORA,
        enviarEmail: async () => ({ enviado: true }),
      }
    );
    const cuponesIds = resultado.cupones.map((c) => c.usuarioId);
    expect([...cuponesIds].sort((a, b) => a - b)).toEqual(
      [...ids].sort((a, b) => a - b)
    );
    expect(cuponesIds).not.toContain(comprador.id);
    expect(cuponesIds).not.toContain(inactivo.id);
  });

  test('caso Cynthia: 1 unidad en el período y 9 previas no alcanza el mínimo de 4', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const cynthia = await crearCliente('Cynthia', 90);
    await crearPedido(cynthia, 60, 9);
    await crearPedido(cynthia, 3, 1);
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['ACTIVO'],
      minUnidadesCompradas: 4,
    });

    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    expect(preview.destinatarios.map((d) => d.usuarioId)).not.toContain(
      cynthia.id
    );

    // Con mínimo 1 sí entra: las 9 unidades previas siguen siendo informativas.
    const conMinimo1 = await previewDestinatarios(
      { ...datos, minUnidadesCompradas: 1 },
      { ahora: AHORA }
    );
    expect(
      conMinimo1.destinatarios.find((d) => d.usuarioId === cynthia.id)
    ).toMatchObject({
      unidades: 1,
      unidadesPrevias: 9,
      unidadesHistoricas: 10,
    });
  });

  test('INACTIVO: compras anteriores y ninguna dentro del período', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const inactivo = await crearCliente('SoloHistorico', 120);
    await crearPedido(inactivo, 45, 3);

    const preview = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );

    expect(preview.destinatarios.map((d) => d.usuarioId)).toContain(
      inactivo.id
    );
    expect(
      preview.destinatarios.find((d) => d.usuarioId === inactivo.id)
    ).toMatchObject({
      unidadesPrevias: 3,
      unidades: 0,
      tipoCliente: 'INACTIVO',
      tiposAplicables: ['INACTIVO'],
    });
  });

  test('INACTIVO: compras anteriores y también dentro del período no clasifica como inactivo', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const reciente = await crearCliente('HistoricoYReciente', 120);
    await crearPedido(reciente, 45, 3);
    await crearPedido(reciente, 4, 2);

    const inactivos = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    expect(inactivos.destinatarios.map((d) => d.usuarioId)).not.toContain(
      reciente.id
    );

    const activos = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['ACTIVO'] }),
      { ahora: AHORA }
    );
    expect(
      activos.destinatarios.find((d) => d.usuarioId === reciente.id)
    ).toMatchObject({
      unidades: 2,
      unidadesPrevias: 3,
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['ACTIVO'],
    });
  });

  test('INACTIVO: sin compras históricas no clasifica como inactivo', async () => {
    const { categoria, activo, nuevo } = await crearEscenario();

    const preview = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    const ids = preview.destinatarios.map((d) => d.usuarioId);

    expect(ids).not.toContain(activo.id);
    expect(ids).not.toContain(nuevo.id);
    expect(preview.destinatarios.every((d) => d.unidadesPrevias > 0)).toBe(
      true
    );
  });

  test('INACTIVO: cuenta compras históricas de hoy inactivos de la categoría', async () => {
    const {
      categoria,
      organizador,
      crearCliente,
      crearPedido,
    } = await crearEscenario();
    const productoBaja = await db.Producto.create({
      nombre: 'Producto dado de baja',
      precio: 1000,
      categoriaId: categoria.id,
      tipo: 'PRODUCTO',
      activo: false,
    });
    const historico = await crearCliente('ComproProductoBaja', 120);
    await crearPedido(historico, 45, 4, undefined, productoBaja);
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['INACTIVO'],
      fechaInicio: fechaEn(2).toISOString(),
    });

    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    expect(
      preview.destinatarios.find((d) => d.usuarioId === historico.id)
    ).toMatchObject({
      unidadesPrevias: 4,
      unidades: 0,
      tipoCliente: 'INACTIVO',
    });

    const ids = preview.destinatarios.map((d) => d.usuarioId);
    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: ids,
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      {
        usuarioId: organizador.id,
        ahora: AHORA,
        enviarEmail: async () => ({ enviado: true }),
      }
    );
    expect(
      resultado.cupones.map((c) => c.usuarioId).sort((a, b) => a - b)
    ).toEqual([...ids].sort((a, b) => a - b));
  });

  test('INACTIVO: la actividad general no depende del catálogo del cupón', async () => {
    const {
      crearCliente,
      crearPedido,
      comprador,
      granComprador,
    } = await crearEscenario();
    const categoriaBaja = await db.Categoria.create({
      nombre: 'Categoria Baja',
    });
    const productoBaja = await db.Producto.create({
      nombre: 'Unico producto de la categoria',
      precio: 1000,
      categoriaId: categoriaBaja.id,
      tipo: 'PRODUCTO',
      activo: false,
    });
    const historico = await crearCliente('HistoricoCategoriaBaja', 120);
    await crearPedido(historico, 45, 4, undefined, productoBaja);

    const inactivos = await previewDestinatarios(
      datosBase({
        categoriaIds: [categoriaBaja.id],
        tiposCliente: ['INACTIVO'],
      }),
      { ahora: AHORA }
    );
    expect(inactivos.destinatarios.map((d) => d.usuarioId)).toContain(
      historico.id
    );

    const activos = await previewDestinatarios(
      datosBase({ categoriaIds: [categoriaBaja.id], tiposCliente: ['ACTIVO'] }),
      { ahora: AHORA }
    );
    // Compraron en el período aunque sea de otra categoría: son ACTIVOS.
    expect(activos.destinatarios.map((d) => d.usuarioId)).toEqual(
      expect.arrayContaining([comprador.id, granComprador.id])
    );
    expect(activos.destinatarios.map((d) => d.usuarioId)).not.toContain(
      historico.id
    );

    const combinados = await previewDestinatarios(
      datosBase({
        categoriaIds: [categoriaBaja.id],
        tiposCliente: ['ACTIVO', 'INACTIVO'],
      }),
      { ahora: AHORA }
    );
    const idsCombinados = combinados.destinatarios.map((d) => d.usuarioId);
    expect(idsCombinados).toEqual(
      expect.arrayContaining([historico.id, comprador.id, granComprador.id])
    );
    expect(new Set(idsCombinados).size).toBe(idsCombinados.length);
  });

  test('INACTIVO: pedidos no entregados no cuentan como compras históricas ni recientes', async () => {
    const {
      categoria,
      producto,
      crearCliente,
      crearPedido,
    } = await crearEscenario();
    const estadoPendiente = await db.EstadoPedido.create({
      nombre: 'pendiente',
      orden: 1,
      esFinal: false,
    });
    const estadoCancelado = await db.EstadoPedido.findOne({
      where: { nombre: 'cancelado' },
    });
    const pendiente = await crearCliente('PendienteHistorico', 120);
    const cancelado = await crearCliente('CanceladoReciente', 120);
    await crearPedido(pendiente, 45, 5, estadoPendiente.id);
    await crearPedido(cancelado, 45, 5, estadoCancelado.id);
    await crearPedido(cancelado, 4, 5, estadoCancelado.id);

    const preview = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    const ids = preview.destinatarios.map((d) => d.usuarioId);

    expect(ids).not.toContain(pendiente.id);
    expect(ids).not.toContain(cancelado.id);
    // El producto sigue siendo el mismo: la exclusión viene del estado.
    expect(producto.tipo).toBe('PRODUCTO');
  });

  test('INACTIVO depende de la actividad general, no del alcance del cupón', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const otraCategoria = await db.Categoria.create({
      nombre: 'Otra Categoria',
    });
    const otroProducto = await db.Producto.create({
      nombre: 'Producto Ajeno',
      precio: 1000,
      categoriaId: otraCategoria.id,
      tipo: 'PRODUCTO',
      activo: true,
    });
    const combo = await db.Producto.create({
      nombre: 'Combo Ajeno',
      precio: 1500,
      categoriaId: categoria.id,
      tipo: 'COMBO',
      activo: true,
    });
    const ajeno = await crearCliente('CompraAjena', 120);
    const delCombo = await crearCliente('CompraCombo', 120);
    await crearPedido(ajeno, 45, 5, undefined, otroProducto);
    await crearPedido(delCombo, 45, 5, undefined, combo);

    const porCategoria = await previewDestinatarios(
      datosBase({ categoriaIds: [categoria.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    const porCategoriaMap = new Map(
      porCategoria.destinatarios.map((d) => [d.usuarioId, d])
    );
    // Aunque compraron fuera del alcance, sí hicieron pedidos entregados
    // anteriormente: son INACTIVOS por actividad general.
    expect(porCategoriaMap.get(ajeno.id)).toMatchObject({
      unidades: 0,
      unidadesPrevias: 0,
      tipoCliente: 'INACTIVO',
    });
    expect(porCategoriaMap.get(delCombo.id)).toMatchObject({
      unidades: 0,
      unidadesPrevias: 0,
      tipoCliente: 'INACTIVO',
    });

    const porProducto = await previewDestinatarios(
      datosBase({ productoIds: [otroProducto.id], tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    const filaCombo = porProducto.destinatarios.find(
      (d) => d.usuarioId === delCombo.id
    );
    expect(filaCombo).toMatchObject({ unidades: 0, tipoCliente: 'INACTIVO' });
  });

  test('INACTIVO combinado con NUEVO y ACTIVO no duplica destinatarios ni cupones', async () => {
    const {
      categoria,
      organizador,
      nuevo,
      activo,
      inactivo,
      comprador,
    } = await crearEscenario();
    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['NUEVO', 'ACTIVO', 'INACTIVO'],
      fechaInicio: fechaEn(2).toISOString(),
    });

    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    const ids = preview.destinatarios.map((d) => d.usuarioId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(nuevo.id);
    expect(ids).toContain(inactivo.id);
    expect(ids).toContain(comprador.id);
    // Sin pedidos en el período, no es ACTIVO ni INACTIVO.
    expect(ids).not.toContain(activo.id);
    expect(
      preview.destinatarios.find((d) => d.usuarioId === inactivo.id).tipoCliente
    ).toBe('INACTIVO');

    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: ids,
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      {
        usuarioId: organizador.id,
        ahora: AHORA,
        enviarEmail: async () => ({ enviado: true }),
      }
    );
    const cuponesIds = resultado.cupones.map((c) => c.usuarioId);
    expect([...cuponesIds].sort((a, b) => a - b)).toEqual(
      [...ids].sort((a, b) => a - b)
    );
    expect(new Set(cuponesIds).size).toBe(cuponesIds.length);
  });

  test('INACTIVO: el mínimo usa el historial y no reescribe la clasificación', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const historico = await crearCliente('HistoricoMinimo', 120);
    await crearPedido(historico, 45, 10);
    const conReciente = await crearCliente('HistoricoConMinimo', 120);
    await crearPedido(conReciente, 45, 10);
    await crearPedido(conReciente, 4, 1);

    const datos = datosBase({
      categoriaIds: [categoria.id],
      tiposCliente: ['INACTIVO'],
      minUnidadesCompradas: 2,
    });
    // Con 10 históricas entra aunque tenga 0 unidades en el período.
    const conMinimo = await previewDestinatarios(datos, { ahora: AHORA });
    expect(conMinimo.destinatarios.map((d) => d.usuarioId)).toContain(
      historico.id
    );
    expect(
      conMinimo.destinatarios.find((d) => d.usuarioId === historico.id)
    ).toMatchObject({
      unidades: 0,
      unidadesPrevias: 10,
      unidadesHistoricas: 10,
      tipoCliente: 'INACTIVO',
    });
    // Con 11 no alcanza sus 10 históricas.
    const exigente = await previewDestinatarios(
      { ...datos, minUnidadesCompradas: 11 },
      { ahora: AHORA }
    );
    expect(exigente.destinatarios.map((d) => d.usuarioId)).not.toContain(
      historico.id
    );

    // El que compró dentro del período es ACTIVO: con ACTIVO el mínimo sigue
    // midiendo sólo las unidades recientes, no las 10 previas.
    const activosDos = await previewDestinatarios(
      { ...datos, tiposCliente: ['ACTIVO'], minUnidadesCompradas: 2 },
      { ahora: AHORA }
    );
    expect(activosDos.destinatarios.map((d) => d.usuarioId)).not.toContain(
      conReciente.id
    );
    const activosUno = await previewDestinatarios(
      { ...datos, tiposCliente: ['ACTIVO'], minUnidadesCompradas: 1 },
      { ahora: AHORA }
    );
    expect(
      activosUno.destinatarios.find((d) => d.usuarioId === conReciente.id)
    ).toMatchObject({
      unidades: 1,
      unidadesPrevias: 10,
      unidadesHistoricas: 11,
      tipoCliente: 'ACTIVO',
    });
  });

  test('ejemplo de período de 4 días: historial, ajeno, incluido y sin pedidos', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const otraCategoria = await db.Categoria.create({
      nombre: 'Otra Categoria 4 dias',
    });
    const otroProducto = await db.Producto.create({
      nombre: 'Producto Ajeno 4 dias',
      precio: 1000,
      categoriaId: otraCategoria.id,
      tipo: 'PRODUCTO',
      activo: true,
    });
    const periodo = { periodoAnalisisDias: 4, categoriaIds: [categoria.id] };

    // Alta anterior al período para aislar la actividad de la fecha de registro.
    const historico = await crearCliente('Historico4Dias', 120);
    await crearPedido(historico, 45, 3);
    const ajeno = await crearCliente('Ajeno4Dias', 120);
    await crearPedido(ajeno, 2, 4, undefined, otroProducto);
    const incluido = await crearCliente('Incluido4Dias', 120);
    await crearPedido(incluido, 2, 3);
    const sinPedidos = await crearCliente('SinPedidos4Dias', 120);
    const nuevo = await crearCliente('Nuevo4Dias', 2);

    const inactivos = await previewDestinatarios(
      datosBase({ ...periodo, tiposCliente: ['INACTIVO'] }),
      { ahora: AHORA }
    );
    const idsInactivos = inactivos.destinatarios.map((d) => d.usuarioId);
    expect(idsInactivos).toContain(historico.id);
    expect(idsInactivos).not.toContain(ajeno.id);
    expect(idsInactivos).not.toContain(incluido.id);
    expect(idsInactivos).not.toContain(sinPedidos.id);
    expect(idsInactivos).not.toContain(nuevo.id);

    const activos = await previewDestinatarios(
      datosBase({ ...periodo, tiposCliente: ['ACTIVO'] }),
      { ahora: AHORA }
    );
    const porId = new Map(activos.destinatarios.map((d) => [d.usuarioId, d]));
    // Compró hace 2 días, pero de otra categoría: ACTIVO con 0 unidades del cupón.
    expect(porId.get(ajeno.id)).toMatchObject({
      unidades: 0,
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['ACTIVO'],
    });
    // Compró hace 2 días un producto incluido: ACTIVO con esas unidades.
    expect(porId.get(incluido.id)).toMatchObject({
      unidades: 3,
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['ACTIVO'],
    });
    expect(porId.has(historico.id)).toBe(false);
    expect(porId.has(sinPedidos.id)).toBe(false);
    expect(porId.has(nuevo.id)).toBe(false);

    const nuevos = await previewDestinatarios(
      datosBase({ ...periodo, tiposCliente: ['NUEVO'] }),
      { ahora: AHORA }
    );
    // Sin pedidos, el cliente nuevo sigue siendo sólo NUEVO, nunca INACTIVO.
    expect(
      nuevos.destinatarios.find((d) => d.usuarioId === nuevo.id)
    ).toMatchObject({ tiposAplicables: ['NUEVO'], tipoCliente: 'NUEVO' });

    const combinados = await previewDestinatarios(
      datosBase({
        ...periodo,
        tiposCliente: ['NUEVO', 'ACTIVO', 'INACTIVO'],
      }),
      { ahora: AHORA }
    );
    const ids = combinados.destinatarios.map((d) => d.usuarioId);
    expect(ids).toEqual(
      expect.arrayContaining([historico.id, ajeno.id, incluido.id, nuevo.id])
    );
    expect(ids).not.toContain(sinPedidos.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('pedidos cancelados o pendientes dentro del período no son actividad', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const estadoCancelado = await db.EstadoPedido.findOne({
      where: { nombre: 'cancelado' },
    });
    const estadoPendiente = await db.EstadoPedido.create({
      nombre: 'pendiente',
      orden: 1,
      esFinal: false,
    });
    const periodo = { periodoAnalisisDias: 4, categoriaIds: [categoria.id] };

    const cancelado = await crearCliente('SoloCancelado4Dias', 120);
    await crearPedido(cancelado, 2, 5, estadoCancelado.id);
    const pendiente = await crearCliente('SoloPendiente4Dias', 120);
    await crearPedido(pendiente, 2, 5, estadoPendiente.id);
    const historicoConCancelado = await crearCliente(
      'HistoricoConCancelado4Dias',
      120
    );
    await crearPedido(historicoConCancelado, 45, 4);
    await crearPedido(historicoConCancelado, 2, 9, estadoCancelado.id);

    const porTipo = async (tipo) => {
      const resultado = await previewDestinatarios(
        datosBase({ ...periodo, tiposCliente: [tipo] }),
        { ahora: AHORA }
      );
      return new Map(resultado.destinatarios.map((d) => [d.usuarioId, d]));
    };

    const activos = await porTipo('ACTIVO');
    expect(activos.has(cancelado.id)).toBe(false);
    expect(activos.has(pendiente.id)).toBe(false);
    expect(activos.has(historicoConCancelado.id)).toBe(false);

    const inactivos = await porTipo('INACTIVO');
    expect(inactivos.has(cancelado.id)).toBe(false);
    expect(inactivos.has(pendiente.id)).toBe(false);
    expect(inactivos.get(historicoConCancelado.id)).toMatchObject({
      unidades: 0,
      unidadesPrevias: 4,
      tipoCliente: 'INACTIVO',
    });
  });

  test('el mínimo de unidades filtra destinatarios sin cambiar su clasificación', async () => {
    const { categoria, crearCliente, crearPedido } = await crearEscenario();
    const otraCategoria = await db.Categoria.create({
      nombre: 'Otra Categoria Minimo',
    });
    const otroProducto = await db.Producto.create({
      nombre: 'Producto Ajeno Minimo',
      precio: 1000,
      categoriaId: otraCategoria.id,
      tipo: 'PRODUCTO',
      activo: true,
    });
    const actividad = {
      creadoEn: fechaHace(120),
      desde: fechaHace(4),
      momento: AHORA,
    };
    expect(
      clasificarTiposCliente({
        ...actividad,
        tienePedidoPeriodo: false,
        tienePedidoAnterior: true,
      })
    ).toEqual(['INACTIVO']);
    expect(
      clasificarTiposCliente({
        ...actividad,
        tienePedidoPeriodo: true,
        tienePedidoAnterior: true,
      })
    ).toEqual(['ACTIVO']);
    expect(
      clasificarTiposCliente({
        ...actividad,
        tienePedidoPeriodo: false,
        tienePedidoAnterior: false,
      })
    ).toEqual([]);

    // Tiene activity general dentro del período, pero 0 unidades del cupón.
    const compradorAjeno = await crearCliente('AjenoConMinimo', 120);
    await crearPedido(compradorAjeno, 2, 6, undefined, otroProducto);
    const datos = datosBase({
      periodoAnalisisDias: 4,
      categoriaIds: [categoria.id],
      tiposCliente: ['ACTIVO'],
      minUnidadesCompradas: null,
    });

    const sinMinimo = await previewDestinatarios(datos, { ahora: AHORA });
    expect(
      sinMinimo.destinatarios.find((d) => d.usuarioId === compradorAjeno.id)
    ).toMatchObject({
      unidades: 0,
      tipoCliente: 'ACTIVO',
      tiposAplicables: ['ACTIVO'],
    });

    // El mínimo alto lo excluye del preview, pero no reescribe su actividad.
    const conMinimo = await previewDestinatarios(
      { ...datos, minUnidadesCompradas: 5 },
      { ahora: AHORA }
    );
    expect(conMinimo.destinatarios.map((d) => d.usuarioId)).not.toContain(
      compradorAjeno.id
    );
    expect(
      clasificarTiposCliente({
        ...actividad,
        tienePedidoPeriodo: true,
        tienePedidoAnterior: false,
      })
    ).toEqual(['ACTIVO']);
  });

  test('normalizadores deduplican, ordenan y rechazan valores inválidos', () => {
    expect(normalizarTiposCliente(['nuevo', 'NUEVO'])).toEqual(['NUEVO']);
    expect(normalizarTiposCliente(['ACTIVO', 'nuevo', 'ACTIVO'])).toEqual([
      'NUEVO',
      'ACTIVO',
    ]);
    expect(() => normalizarTiposCliente(['OTRO'])).toThrow();
    expect(normalizarMinUnidadesCompradas('')).toBeNull();
    expect(normalizarMinUnidadesCompradas('4')).toBe(4);
    expect(() => normalizarMinUnidadesCompradas(-1)).toThrow();
  });
});

describe('cupones programados', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  test('no envía al crear, envía una sola vez al activarse y respeta bajas', async () => {
    const { categoria, organizador, granComprador } = await crearEscenario();
    const datos = datosBase({
      categoriaIds: [categoria.id],
      fechaInicio: fechaEn(2).toISOString(),
    });
    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    const enviados = [];
    const opts = (ahora) => ({
      usuarioId: organizador.id,
      ahora,
      enviarEmail: async (payload) => {
        enviados.push(payload.destinatario);
        return { enviado: true };
      },
    });

    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      opts(AHORA)
    );

    expect(resultado.programada).toBe(true);
    expect(resultado.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
    resultado.cupones.forEach((c) => {
      expect(c.estadoEnvio).toBe(ESTADOS_ENVIO.PENDIENTE);
    });
    await expect(
      reenviarEmision(resultado.emision.id, opts(AHORA))
    ).rejects.toMatchObject({ motivo: 'emision_programada' });

    // Un cupón dado de baja no debe recibir el correo al activarse.
    const cuponBaja = await db.Cupon.findOne({
      where: { emisionId: resultado.emision.id, usuarioId: granComprador.id },
    });
    await cuponBaja.update({ activo: false });
    const activacion = fechaEn(2);

    const primera = await enviarCuponesProgramados(opts(activacion));
    expect(primera.enviados).toBe(resultado.cupones.length - 1);
    expect(enviados).toHaveLength(resultado.cupones.length - 1);
    expect(enviados).not.toContain('grancomprador@test.com');

    // Reintentos y reinicios no duplican notificaciones.
    const segunda = await enviarCuponesProgramados(opts(activacion));
    expect(segunda.enviados).toBe(0);
    expect(enviados).toHaveLength(resultado.cupones.length - 1);

    const emision = await db.CuponEmision.findByPk(resultado.emision.id);
    expect(emision.estado).toBe(ESTADOS_EMISION.COMPLETADA);
    expect(emision.cantidadEnviados).toBe(resultado.cupones.length - 1);
  });

  test('Mis cupones sólo muestra el cupón después de enviar el correo', async () => {
    const {
      categoria,
      organizador,
      comprador,
      granComprador,
    } = await crearEscenario();
    const datos = datosBase({
      categoriaIds: [categoria.id],
      fechaInicio: fechaEn(2).toISOString(),
    });
    const preview = await previewDestinatarios(datos, { ahora: AHORA });
    const correoFallido = 'grancomprador@test.com';
    const opts = (ahora) => ({
      usuarioId: organizador.id,
      ahora,
      enviarEmail: async ({ destinatario }) =>
        destinatario === correoFallido
          ? { enviado: false, motivo: 'smtp caído' }
          : { enviado: true },
    });
    const resultado = await emitir(
      {
        ...datos,
        destinatariosIds: preview.destinatarios.map((d) => d.usuarioId),
        previewToken: preview.previewToken,
        previewExpiraEn: preview.previewExpiraEn,
      },
      opts(AHORA)
    );
    expect(resultado.programada).toBe(true);

    // Programados: existen en la base pero no aparecen para ningún cliente.
    for (const destinatario of preview.destinatarios) {
      expect(await listarCuponesCliente(destinatario.usuarioId)).toEqual([]);
    }

    await enviarCuponesProgramados(opts(fechaEn(2)));

    // Enviado: visible en "Mis cupones" (y en el carrito, que lee lo mismo).
    const delComprador = await listarCuponesCliente(comprador.id);
    expect(delComprador).toHaveLength(1);
    expect(delComprador[0].estadoEnvio).toBe(ESTADOS_ENVIO.ENVIADO);

    // Fallido: sigue sin aparecer, aunque la fila queda para auditoría/reenvío.
    expect(await listarCuponesCliente(granComprador.id)).toEqual([]);
    const fallido = await db.Cupon.findOne({
      where: {
        emisionId: resultado.emision.id,
        usuarioId: granComprador.id,
      },
    });
    expect(fallido.estadoEnvio).toBe(ESTADOS_ENVIO.FALLIDO);
  });
});
