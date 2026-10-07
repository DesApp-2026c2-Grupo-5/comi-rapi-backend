import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { EstadoPedido, Pedido, Sucursal } = db;

const agenteSuper = request.agent(app);
const agenteAdmin = request.agent(app);
const agenteCliente = request.agent(app);

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

describe('Superadmin controller (métricas globales)', () => {
  let cliente;
  let centro;
  let norte;
  let estados;

  beforeAll(async () => {
    await cleanDb();
    centro = await Sucursal.create({ nombre: 'Centro' });
    norte = await Sucursal.create({ nombre: 'Norte' });
    cliente = await crearUsuario({
      email: 'dueno-metricas@test.com',
      rol: 'CLIENTE',
    });
    estados = {};
    const ordenes = [
      ['pendiente', { esInicial: true }],
      ['confirmado', {}],
      ['en_preparacion', {}],
      ['listo_para_entregar', {}],
      ['en_camino', {}],
      ['entregado', { esFinal: true }],
      ['cancelado', { esFinal: true }],
    ];
    for (const [nombre, extras] of ordenes) {
      const creado = await EstadoPedido.create({
        nombre,
        orden: Object.keys(estados).length + 1,
        ...extras,
      });
      estados[nombre] = creado.id;
    }

    // 5 pedidos: 3 son venta (3500), 1 cancelado y 1 pendiente no suman ingresos.
    await Pedido.bulkCreate([
      {
        usuarioId: cliente.id,
        sucursalId: centro.id,
        estadoId: estados.confirmado,
        total: 1000,
      },
      {
        usuarioId: cliente.id,
        sucursalId: centro.id,
        estadoId: estados.entregado,
        total: 500,
      },
      {
        usuarioId: cliente.id,
        sucursalId: norte.id,
        estadoId: estados.confirmado,
        total: 2000,
      },
      {
        usuarioId: cliente.id,
        sucursalId: centro.id,
        estadoId: estados.cancelado,
        total: 9999,
      },
      {
        usuarioId: cliente.id,
        sucursalId: centro.id,
        estadoId: estados.pendiente,
        total: 42,
      },
    ]);

    await registrarYLoguear(
      agenteSuper,
      'super-metricas@test.com',
      'SUPERADMINISTRADOR'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-metricas@test.com',
      'ADMINISTRADOR',
      centro.id
    );
    await registrarYLoguear(agenteCliente, 'cli-metricas@test.com', 'CLIENTE');
  });

  it('responde 401 sin sesión', async () => {
    const res = await request(app).get('/api/superadmin/resumen');
    expect([401, 403]).toContain(res.statusCode);
  });

  it('rechaza a ADMINISTRADOR (403)', async () => {
    const res = await agenteAdmin.get('/api/superadmin/resumen');
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('rechaza a CLIENTE (403)', async () => {
    const res = await agenteCliente.get('/api/superadmin/resumen');
    expect(res.statusCode).toBe(403);
  });

  it('SUPERADMIN recibe el resumen agregado', async () => {
    const res = await agenteSuper.get('/api/superadmin/resumen');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const {
      pedidos,
      porEstado,
      porSucursal,
      porDia,
      operacion,
    } = res.body.data;

    expect(pedidos).toEqual({
      total: 5,
      vendidos: 3,
      pendientes: 1,
      ingresos: 3500,
    });

    const porNombre = Object.fromEntries(
      porEstado.map((fila) => [fila.estado, fila])
    );
    expect(porNombre.confirmado).toEqual({
      estado: 'confirmado',
      cantidad: 2,
      ingresos: 3000,
    });
    expect(porNombre.entregado).toEqual({
      estado: 'entregado',
      cantidad: 1,
      ingresos: 500,
    });
    expect(porNombre.cancelado).toEqual({
      estado: 'cancelado',
      cantidad: 1,
      ingresos: 0,
    });
    expect(porNombre.pendiente).toEqual({
      estado: 'pendiente',
      cantidad: 1,
      ingresos: 0,
    });

    const local = Object.fromEntries(
      porSucursal.map((fila) => [fila.sucursal, fila])
    );
    expect(local.Centro).toEqual({
      sucursalId: centro.id,
      sucursal: 'Centro',
      cantidad: 2,
      ingresos: 1500,
    });
    expect(local.Norte).toEqual({
      sucursalId: norte.id,
      sucursal: 'Norte',
      cantidad: 1,
      ingresos: 2000,
    });

    const hoy = porDia.find((fila) => fila.cantidad > 0);
    expect(hoy.ingresos).toBe(3500);

    expect(operacion.sucursalesActivas).toBe(2);
    expect(operacion.clientes).toBe(2);
    expect(operacion.administradores).toBe(1);
  });
});
