/**
 * Tests HTTP del scoping de stock por sucursal operativa.
 *
 * El ADMINISTRADOR ve/escribe sólo la matriz de su sucursal asignada; el
 * SUPERADMINISTRADOR, la de su contexto elegido (/api/auth/sucursal-contexto).
 * Sin contexto, el superadmin no opera stock (403); con él, no puede tocar
 * otra sucursal (acotarASucursalPropia) ni espiarla (index ignora ?sucursalId=).
 */
import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Categoria, Producto, Stock, Sucursal } = db;

const agenteAdmin = request.agent(app);
const agenteSuperadmin = request.agent(app);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function loguear(agente, email) {
  const csrf = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: '123456' });
}

async function elegirContexto(agente, sucursalId) {
  const csrf = await obtenerCsrf(agente);
  const res = await agente
    .post('/api/auth/sucursal-contexto')
    .set('x-csrf-token', csrf)
    .send({ sucursalId });
  expect(res.statusCode).toBe(200);
}

describe('Stock: scoping por sucursal operativa', () => {
  let sucursalA;
  let sucursalB;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const sucursales = await Sucursal.bulkCreate([
      { nombre: 'Sucursal A' },
      { nombre: 'Sucursal B' },
    ]);
    [sucursalA, sucursalB] = sucursales;
    const categoria = await Categoria.create({
      nombre: 'Bebidas',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Gaseosa Test',
      precio: 100,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    await Stock.create({
      sucursalId: sucursalA.id,
      productoId: producto.id,
      cantidad: 10,
      disponible: true,
    });
    await Stock.create({
      sucursalId: sucursalB.id,
      productoId: producto.id,
      cantidad: 20,
      disponible: true,
    });
    await crearUsuario({
      email: 'admin-stock-a@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursalA.id,
    });
    await crearUsuario({
      email: 'superadmin-stock@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    await loguear(agenteAdmin, 'admin-stock-a@test.com');
    await loguear(agenteSuperadmin, 'superadmin-stock@test.com');
  });

  it('el admin ve solo la matriz de su sucursal asignada', async () => {
    const res = await agenteAdmin.get('/api/stock');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].sucursalId).toBe(sucursalA.id);
  });

  it('?sucursalId= de la query no amplía el alcance del admin', async () => {
    const res = await agenteAdmin.get(`/api/stock?sucursalId=${sucursalB.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].sucursalId).toBe(sucursalA.id);
  });

  it('superadmin sin contexto → 403', async () => {
    const res = await agenteSuperadmin.get('/api/stock');
    expect(res.statusCode).toBe(403);
  });

  it('superadmin con contexto A ve solo esa matriz; al cambiar de contexto cambia la matriz', async () => {
    await elegirContexto(agenteSuperadmin, sucursalA.id);
    const resA = await agenteSuperadmin.get('/api/stock');
    expect(resA.statusCode).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].sucursalId).toBe(sucursalA.id);

    await elegirContexto(agenteSuperadmin, sucursalB.id);
    const resB = await agenteSuperadmin.get('/api/stock');
    expect(resB.statusCode).toBe(200);
    expect(resB.body.data).toHaveLength(1);
    expect(resB.body.data[0].sucursalId).toBe(sucursalB.id);
  });

  it('superadmin con contexto A escribe el stock de A y no el de B', async () => {
    await elegirContexto(agenteSuperadmin, sucursalA.id);
    const csrf = await obtenerCsrf(agenteSuperadmin);

    const ajena = await agenteSuperadmin
      .put(`/api/stock/${sucursalB.id}/${producto.id}`)
      .set('x-csrf-token', csrf)
      .send({ cantidad: 5 });
    expect(ajena.statusCode).toBe(403);

    const propia = await agenteSuperadmin
      .put(`/api/stock/${sucursalA.id}/${producto.id}`)
      .set('x-csrf-token', csrf)
      .send({ cantidad: 50 });
    expect(propia.statusCode).toBe(200);
    expect(propia.body.data.cantidad).toBe(50);

    // La sucursal B no fue tocada.
    const filaB = await Stock.findOne({
      where: { sucursalId: sucursalB.id, productoId: producto.id },
    });
    expect(filaB.cantidad).toBe(20);
  });
});
