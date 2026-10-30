import request from 'supertest';
import { cleanDb, crearParametros, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

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
} = db;

const agenteSuper = request.agent(app);
const agenteAdmin = request.agent(app);
const agenteAdminSinSucursal = request.agent(app);
const agenteCliente = request.agent(app);

const DESDE = '2026-01-01';
const HASTA = '2026-01-31';
const RANGO = `desde=${DESDE}&hasta=${HASTA}`;

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function registrarYLoguear(agente, email, rol, sucursalId = null) {
  await crearUsuario({ email, rol, sucursalId });
  const csrf = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: '123456' });
}

const fecha = (anio, mes, dia, hora = 12) =>
  new Date(
    `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(
      2,
      '0'
    )}T${String(hora).padStart(2, '0')}:00:00-03:00`
  );

function hoyEnArgentina() {
  const partes = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .forEach(({ type, value }) => {
      if (type !== 'literal') partes[type] = value;
    });
  return `${partes.year}-${partes.month}-${partes.day}`;
}

describe('Reportes controller', () => {
  let centro;
  let norte;
  let estados;
  let p1;
  let p2;
  let p3;
  let promo;
  let cliente1;
  let cliente2;

  beforeAll(async () => {
    await cleanDb();
    await crearParametros({ stockCriticoUmbral: 2 });

    centro = await Sucursal.create({ nombre: 'Centro' });
    norte = await Sucursal.create({ nombre: 'Norte' });

    estados = {};
    const nombres = [
      ['pendiente', { esInicial: true }],
      ['confirmado', {}],
      ['en_preparacion', {}],
      ['listo_para_entregar', {}],
      ['en_camino', {}],
      ['entregado', { esFinal: true }],
      ['cancelado', { esFinal: true }],
    ];
    for (const [nombre, extras] of nombres) {
      const creado = await EstadoPedido.create({
        nombre,
        orden: Object.keys(estados).length + 1,
        ...extras,
      });
      estados[nombre] = creado.id;
    }

    const categoria = await Categoria.create({ nombre: 'Comidas' });
    const crearProducto = (nombre, precio) =>
      Producto.create({
        nombre,
        precio,
        categoriaId: categoria.id,
        tipo: 'PRODUCTO',
        activo: true,
      });
    p1 = await crearProducto('Producto 1', 300);
    p2 = await crearProducto('Producto 2', 200);
    p3 = await crearProducto('Producto 3', 100);

    promo = await Promocion.create({
      nombre: 'Promo 10%',
      tipo: 'DESCUENTO_PORCENTUAL',
      valor: 10,
      activa: true,
    });

    cliente1 = await crearUsuario({
      email: 'cliente1-reportes@test.com',
      rol: 'CLIENTE',
    });
    cliente2 = await crearUsuario({
      email: 'cliente2-reportes@test.com',
      rol: 'CLIENTE',
    });
    await crearUsuario({
      email: 'cliente3-reportes@test.com',
      rol: 'CLIENTE',
    });

    await Pedido.bulkCreate([
      {
        usuarioId: cliente1.id,
        sucursalId: centro.id,
        estadoId: estados.entregado,
        total: 1050,
        fechaHora: fecha(2026, 1, 10, 12),
      },
      {
        usuarioId: cliente1.id,
        sucursalId: centro.id,
        estadoId: estados.entregado,
        total: 650,
        fechaHora: fecha(2026, 1, 10, 13),
      },
      {
        usuarioId: cliente2.id,
        sucursalId: norte.id,
        estadoId: estados.entregado,
        total: 950,
        fechaHora: fecha(2026, 1, 11, 20),
      },
      {
        usuarioId: cliente1.id,
        sucursalId: centro.id,
        estadoId: estados.confirmado,
        total: 9999,
        fechaHora: fecha(2026, 1, 10, 12),
      },
      {
        usuarioId: cliente2.id,
        sucursalId: centro.id,
        estadoId: estados.cancelado,
        total: 300,
        fechaHora: fecha(2026, 1, 12, 9),
      },
      {
        usuarioId: cliente1.id,
        sucursalId: norte.id,
        estadoId: estados.pendiente,
        total: 42,
        fechaHora: fecha(2026, 1, 12, 20),
      },
      {
        usuarioId: cliente2.id,
        sucursalId: centro.id,
        estadoId: estados.entregado,
        total: 800,
        fechaHora: fecha(2025, 12, 15, 10),
      },
      {
        usuarioId: cliente2.id,
        sucursalId: centro.id,
        estadoId: estados.entregado,
        total: 400,
        fechaHora: new Date(),
      },
    ]);

    const pedidos = await Pedido.findAll({ order: [['id', 'ASC']] });
    const [a, b, c] = pedidos;
    const canceladoPedido = pedidos.find(
      (pedido) => pedido.estadoId === estados.cancelado
    );

    await PedidoItem.bulkCreate([
      {
        pedidoId: a.id,
        productoId: p1.id,
        nombreProducto: p1.nombre,
        precioUnitario: 300,
        cantidad: 2,
        subtotal: 600,
      },
      {
        pedidoId: a.id,
        productoId: p2.id,
        nombreProducto: p2.nombre,
        precioUnitario: 200,
        cantidad: 1,
        subtotal: 200,
      },
      {
        pedidoId: b.id,
        productoId: p1.id,
        nombreProducto: p1.nombre,
        precioUnitario: 300,
        cantidad: 1,
        subtotal: 300,
      },
      {
        pedidoId: c.id,
        productoId: p2.id,
        nombreProducto: p2.nombre,
        precioUnitario: 200,
        cantidad: 3,
        subtotal: 600,
      },
      {
        pedidoId: canceladoPedido.id,
        productoId: p3.id,
        nombreProducto: p3.nombre,
        precioUnitario: 100,
        cantidad: 2,
        subtotal: 200,
      },
    ]);

    await PedidoPromocion.create({
      pedidoId: a.id,
      promocionId: promo.id,
      descuentoAplicado: 100,
    });

    await Stock.bulkCreate([
      {
        sucursalId: centro.id,
        productoId: p1.id,
        cantidad: 0,
        disponible: true,
      },
      {
        sucursalId: centro.id,
        productoId: p2.id,
        cantidad: 5,
        disponible: true,
      },
      {
        sucursalId: centro.id,
        productoId: p3.id,
        cantidad: 2,
        disponible: true,
      },
      {
        sucursalId: norte.id,
        productoId: p1.id,
        cantidad: 0,
        disponible: true,
      },
      {
        sucursalId: norte.id,
        productoId: p2.id,
        cantidad: 1,
        disponible: true,
      },
      {
        sucursalId: norte.id,
        productoId: p3.id,
        cantidad: 10,
        disponible: false,
      },
    ]);

    await registrarYLoguear(
      agenteSuper,
      'super-reportes@test.com',
      'SUPERADMINISTRADOR'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-reportes@test.com',
      'ADMINISTRADOR',
      centro.id
    );
    await registrarYLoguear(
      agenteAdminSinSucursal,
      'admin-sin-sucursal@test.com',
      'ADMINISTRADOR'
    );
    await registrarYLoguear(agenteCliente, 'cli-reportes@test.com', 'CLIENTE');
  });

  it('responde 401 sin sesión', async () => {
    const res = await request(app).get(`/api/reportes?${RANGO}`);
    expect([401, 403]).toContain(res.statusCode);
  });

  it('rechaza a CLIENTE (403)', async () => {
    const res = await agenteCliente.get(`/api/reportes?${RANGO}`);
    expect(res.statusCode).toBe(403);
  });

  it('rechaza a ADMINISTRADOR sin sucursal (403)', async () => {
    const res = await agenteAdminSinSucursal.get(`/api/reportes?${RANGO}`);
    expect(res.statusCode).toBe(403);
  });

  it('valida el período', async () => {
    const invertido = await agenteSuper.get(
      '/api/reportes?desde=2026-01-31&hasta=2026-01-01'
    );
    expect(invertido.statusCode).toBe(400);
    expect(invertido.body.success).toBe(false);

    const formato = await agenteSuper.get(
      '/api/reportes?desde=01/01/2026&hasta=31/01/2026'
    );
    expect(formato.statusCode).toBe(400);

    const parcial = await agenteSuper.get('/api/reportes?desde=2026-01-01');
    expect(parcial.statusCode).toBe(400);
  });

  it('SUPERADMIN ve el reporte global con solo entregados como venta', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { periodo, resumen } = res.body.data;
    expect(periodo).toEqual({
      desde: DESDE,
      hasta: HASTA,
      sucursalId: null,
      sucursal: null,
    });
    expect(resumen).toMatchObject({
      pedidos: 6,
      entregados: 3,
      facturacion: 2650,
      ticketPromedio: 883.33,
    });
    expect(resumen.anterior).toMatchObject({
      desde: '2025-12-01',
      hasta: '2025-12-31',
      pedidos: 1,
      entregados: 1,
      facturacion: 800,
    });
    expect(resumen.anterior.variacionFacturacion).toBe(231.3);
  });

  it('calcula pedidos y facturación por día completando los días sin actividad', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { porDia } = res.body.data;
    expect(porDia).toHaveLength(31);
    const porClave = Object.fromEntries(porDia.map((fila) => [fila.dia, fila]));
    expect(porClave['2026-01-10']).toEqual({
      dia: '2026-01-10',
      pedidos: 3,
      entregados: 2,
      facturacion: 1700,
    });
    expect(porClave['2026-01-11']).toEqual({
      dia: '2026-01-11',
      pedidos: 1,
      entregados: 1,
      facturacion: 950,
    });
    expect(porClave['2026-01-12']).toEqual({
      dia: '2026-01-12',
      pedidos: 2,
      entregados: 0,
      facturacion: 0,
    });
    expect(porClave['2026-01-20']).toEqual({
      dia: '2026-01-20',
      pedidos: 0,
      entregados: 0,
      facturacion: 0,
    });
  });

  it('distribuye todos los pedidos del período por estado actual', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const porEstado = Object.fromEntries(
      res.body.data.porEstado.map((fila) => [fila.estado, fila])
    );
    expect(porEstado.entregado).toEqual({
      estado: 'entregado',
      cantidad: 3,
      importe: 2650,
    });
    expect(porEstado.confirmado).toEqual({
      estado: 'confirmado',
      cantidad: 1,
      importe: 9999,
    });
    expect(porEstado.cancelado.cantidad).toBe(1);
    expect(porEstado.pendiente.cantidad).toBe(1);
    expect(porEstado.en_camino.cantidad).toBe(0);
  });

  it('compara sucursales con pedidos, entregados y facturación', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const local = Object.fromEntries(
      res.body.data.porSucursal.map((fila) => [fila.sucursal, fila])
    );
    expect(local.Centro).toEqual({
      sucursalId: centro.id,
      sucursal: 'Centro',
      pedidos: 4,
      entregados: 2,
      facturacion: 1700,
      cancelados: 1,
    });
    expect(local.Norte).toEqual({
      sucursalId: norte.id,
      sucursal: 'Norte',
      pedidos: 2,
      entregados: 1,
      facturacion: 950,
      cancelados: 0,
    });
  });

  it('ordena productos por unidades y por facturación', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { productos } = res.body.data;

    expect(productos.masVendidos.map((item) => item.nombre)).toEqual([
      'Producto 2',
      'Producto 1',
    ]);
    expect(productos.masVendidos[0]).toMatchObject({
      unidades: 4,
      facturacion: 800,
      categoria: 'Comidas',
    });
    expect(productos.mayorFacturacion.map((item) => item.nombre)).toEqual([
      'Producto 1',
      'Producto 2',
    ]);
    expect(productos.mayorFacturacion[0].facturacion).toBe(900);
    expect(productos.menosVendidos.map((item) => item.nombre)).toEqual([
      'Producto 1',
      'Producto 2',
    ]);
    expect(productos.menosVendidos[0]).toMatchObject({
      nombre: 'Producto 1',
      categoria: 'Comidas',
      unidades: 3,
      facturacion: 900,
    });
  });

  it('reporta stock sin existencias y crítico según el umbral configurado', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { stock } = res.body.data;
    expect(stock.umbralCritico).toBe(2);
    expect(
      stock.sinStock.map((item) => `${item.sucursal}:${item.producto}`).sort()
    ).toEqual(['Centro:Producto 1', 'Norte:Producto 1', 'Norte:Producto 3']);
    expect(
      stock.critico.map((item) => `${item.sucursal}:${item.producto}`).sort()
    ).toEqual(['Centro:Producto 3', 'Norte:Producto 2']);
  });

  it('calcula demanda por franja horaria y día de la semana', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { franjaHoraria, porDiaSemana } = res.body.data;
    expect(franjaHoraria).toHaveLength(24);
    const horas = Object.fromEntries(
      franjaHoraria.map((fila) => [fila.hora, fila.pedidos])
    );
    expect(horas[9]).toBe(1);
    expect(horas[12]).toBe(2);
    expect(horas[13]).toBe(1);
    expect(horas[20]).toBe(2);
    expect(horas[3]).toBe(0);
    expect(porDiaSemana).toHaveLength(7);
    expect(porDiaSemana.reduce((total, fila) => total + fila.pedidos, 0)).toBe(
      6
    );
  });

  it('calcula cancelaciones, porcentaje y distribución', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { cancelaciones } = res.body.data;
    expect(cancelaciones.cantidad).toBe(1);
    expect(cancelaciones.pedidosTotales).toBe(6);
    expect(cancelaciones.porcentaje).toBe(16.7);
    const local = Object.fromEntries(
      cancelaciones.porSucursal.map((fila) => [fila.sucursal, fila])
    );
    expect(local.Centro).toMatchObject({ cantidad: 1, pedidos: 4 });
    expect(local.Centro.porcentaje).toBe(25);
    expect(local.Norte).toMatchObject({ cantidad: 0, pedidos: 2 });
    expect(cancelaciones.porDia).toEqual([{ dia: '2026-01-12', cantidad: 1 }]);
    expect(cancelaciones.productos).toEqual([
      {
        productoId: p3.id,
        nombre: 'Producto 3',
        categoria: 'Comidas',
        unidades: 2,
        pedidos: 1,
        importe: 200,
      },
    ]);
  });

  it('calcula rendimiento de promociones sin duplicar pedidos', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { promociones } = res.body.data;
    expect(promociones.pedidosConPromocion).toBe(1);
    expect(promociones.facturacionConPromocion).toBe(1050);
    expect(promociones.descuentoTotal).toBe(100);
    expect(promociones.porPromocion).toEqual([
      {
        promocionId: promo.id,
        nombre: 'Promo 10%',
        pedidos: 1,
        descuento: 100,
        facturacion: 1050,
      },
    ]);
  });

  it('calcula métricas de clientes', async () => {
    const res = await agenteSuper.get(`/api/reportes?${RANGO}`);
    const { clientes } = res.body.data;
    expect(clientes.nuevos).toBe(0);
    expect(clientes.conPedidos).toBe(2);
    expect(clientes.recurrentes).toBe(1);
    expect(clientes.ticketPromedio).toBe(1325);
    expect(clientes.top[0]).toMatchObject({
      usuarioId: cliente1.id,
      pedidos: 2,
      facturacion: 1700,
    });
    expect(clientes.top[1]).toMatchObject({
      usuarioId: cliente2.id,
      pedidos: 1,
      facturacion: 950,
    });
  });

  it('el ADMINISTRADOR solo ve su sucursal e ignora el sucursalId del request', async () => {
    const res = await agenteAdmin.get(
      `/api/reportes?${RANGO}&sucursalId=${norte.id}`
    );
    expect(res.statusCode).toBe(200);
    const {
      periodo,
      resumen,
      porSucursal,
      stock,
      cancelaciones,
      clientes,
    } = res.body.data;

    expect(periodo.sucursalId).toBe(centro.id);
    expect(periodo.sucursal).toBe('Centro');
    expect(resumen).toMatchObject({
      pedidos: 4,
      entregados: 2,
      facturacion: 1700,
      ticketPromedio: 850,
    });
    expect(porSucursal).toHaveLength(1);
    expect(porSucursal[0].sucursal).toBe('Centro');
    expect(stock.sinStock.map((item) => item.sucursal)).toEqual(['Centro']);
    expect(stock.critico.map((item) => item.producto)).toEqual(['Producto 3']);
    expect(cancelaciones).toMatchObject({
      cantidad: 1,
      pedidosTotales: 4,
      porcentaje: 25,
    });
    expect(clientes.conPedidos).toBe(1);
    expect(clientes.recurrentes).toBe(1);
  });

  it('el SUPERADMIN puede filtrar por sucursal', async () => {
    const res = await agenteSuper.get(
      `/api/reportes?${RANGO}&sucursalId=${norte.id}`
    );
    expect(res.statusCode).toBe(200);
    const {
      periodo,
      resumen,
      porSucursal,
      promociones,
      clientes,
    } = res.body.data;

    expect(periodo.sucursalId).toBe(norte.id);
    expect(periodo.sucursal).toBe('Norte');
    expect(resumen).toMatchObject({
      pedidos: 2,
      entregados: 1,
      facturacion: 950,
      ticketPromedio: 950,
    });
    expect(porSucursal).toHaveLength(1);
    expect(porSucursal[0].sucursal).toBe('Norte');
    expect(promociones.pedidosConPromocion).toBe(0);
    expect(promociones.porPromocion).toEqual([]);
    expect(clientes.conPedidos).toBe(1);
    expect(clientes.recurrentes).toBe(0);
  });

  it('devuelve 404 si el superadmin filtra por una sucursal inexistente', async () => {
    const res = await agenteSuper.get(
      `/api/reportes?${RANGO}&sucursalId=99999`
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('sin parámetros usa los últimos 30 días y cuenta clientes nuevos', async () => {
    const res = await agenteSuper.get('/api/reportes');
    expect(res.statusCode).toBe(200);
    const { periodo, resumen, clientes } = res.body.data;

    const hasta = hoyEnArgentina();
    expect(periodo.hasta).toBe(hasta);
    expect(periodo.desde).not.toBe(hasta);
    expect(resumen).toMatchObject({
      pedidos: 1,
      entregados: 1,
      facturacion: 400,
    });
    expect(clientes.nuevos).toBe(4);
    expect(clientes.conPedidos).toBe(1);
  });
});
