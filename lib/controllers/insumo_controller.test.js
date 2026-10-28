/**
 * Pruebas HTTP del catálogo de insumos y del stock de extras/condimentos.
 *
 * El catálogo lo escribe sólo el SUPERADMINISTRADOR; el stock lo opera el
 * ADMINISTRADOR de su sucursal. Estas pruebas verifican ambos scopes y que el
 * listado público no exponga insumos dados de baja.
 */
import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { InsumoStock, Sucursal } = db;

const agenteSuperadmin = request.agent(app);
const agenteAdmin = request.agent(app);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function loguear(agente, email) {
  const csrf = await obtenerCsrf(agente);
  const res = await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: '123456' });
  expect(res.statusCode).toBe(200);
}

async function pedir(agente, metodo, url, body) {
  const csrf = await obtenerCsrf(agente);
  return agente[metodo](url).set('x-csrf-token', csrf).send(body);
}

describe('Insumos: catálogo y stock', () => {
  let sucursalA;
  let sucursalB;
  let insumoId;

  beforeAll(async () => {
    await cleanDb();
    [sucursalA, sucursalB] = await Sucursal.bulkCreate([
      { nombre: 'Sucursal A', activa: true },
      { nombre: 'Sucursal B', activa: true },
    ]);
    await crearUsuario({
      email: 'admin-insumos@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursalA.id,
    });
    await crearUsuario({
      email: 'superadmin-insumos@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    await loguear(agenteAdmin, 'admin-insumos@test.com');
    await loguear(agenteSuperadmin, 'superadmin-insumos@test.com');
  });

  it('el admin no puede crear insumos en el catálogo corporativo', async () => {
    const res = await pedir(agenteAdmin, 'post', '/api/insumos', {
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });
    expect(res.statusCode).toBe(403);
  });

  it('el superadmin da de alta un extra con su stock en 0', async () => {
    const res = await pedir(agenteSuperadmin, 'post', '/api/insumos', {
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });
    expect(res.statusCode).toBe(201);
    insumoId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      nombre: 'Bacon',
      tipo: 'extra',
      activo: true,
      stockTotal: 0,
    });
    expect(Number(res.body.data.precio)).toBe(500);
    expect(res.body.data.insumoId).toBeUndefined();

    const filas = await InsumoStock.findAll({ where: { insumoId } });
    expect(filas).toHaveLength(2);
  });

  it('valida los datos del insumo', async () => {
    const sinPrecio = await pedir(agenteSuperadmin, 'post', '/api/insumos', {
      nombre: 'Cheddar',
      tipo: 'extra',
    });
    expect(sinPrecio.statusCode).toBe(400);
    expect(sinPrecio.body.error).toBe('El precio es obligatorio para un extra');

    const duplicado = await pedir(agenteSuperadmin, 'post', '/api/insumos', {
      nombre: 'bacon',
      tipo: 'extra',
      precio: 700,
    });
    expect(duplicado.statusCode).toBe(409);
  });

  it('el listado público sólo trae activos; el superadmin puede pedir los dados de baja', async () => {
    const publico = await request(app).get('/api/insumos');
    expect(publico.statusCode).toBe(200);
    expect(publico.body.data).toHaveLength(1);

    const editado = await pedir(
      agenteSuperadmin,
      'put',
      `/api/insumos/${insumoId}`,
      { nombre: 'Bacon ahumado', precio: 650 }
    );
    expect(editado.statusCode).toBe(200);
    expect(editado.body.data).toMatchObject({
      nombre: 'Bacon ahumado',
    });
    expect(Number(editado.body.data.precio)).toBe(650);

    const baja = await pedir(
      agenteSuperadmin,
      'delete',
      `/api/insumos/${insumoId}`
    );
    expect(baja.statusCode).toBe(200);

    const publicoDespues = await request(app).get('/api/insumos');
    expect(publicoDespues.body.data).toHaveLength(0);

    const gestion = await agenteSuperadmin.get('/api/insumos?activo=false');
    expect(gestion.statusCode).toBe(200);
    expect(gestion.body.data).toHaveLength(1);
    expect(gestion.body.data[0].activo).toBe(false);
    // Las filas de stock se conservan: la baja es lógica.
    expect(await InsumoStock.count({ where: { insumoId } })).toBe(2);
  });

  it('el admin ve sólo el stock de su sucursal y no puede tocar otra', async () => {
    const insumo = await db.Insumo.create({
      nombre: 'Ketchup',
      tipo: 'condimento',
      precio: null,
      activo: true,
    });
    await InsumoStock.bulkCreate([
      {
        sucursalId: sucursalA.id,
        insumoId: insumo.id,
        cantidad: 3,
        disponible: true,
      },
      {
        sucursalId: sucursalB.id,
        insumoId: insumo.id,
        cantidad: 8,
        disponible: true,
      },
    ]);

    const listado = await agenteAdmin.get('/api/stock/insumos');
    expect(listado.statusCode).toBe(200);
    expect(listado.body.data).toHaveLength(1);
    expect(listado.body.data[0]).toMatchObject({
      sucursalId: sucursalA.id,
      insumoId: insumo.id,
      insumo: 'Ketchup',
      tipo: 'condimento',
      cantidad: 3,
    });

    const actualizado = await pedir(
      agenteAdmin,
      'put',
      `/api/stock/insumos/${insumo.id}`,
      { cantidad: 11 }
    );
    expect(actualizado.statusCode).toBe(200);
    expect(actualizado.body.data).toMatchObject({
      sucursalId: sucursalA.id,
      cantidad: 11,
    });

    // La sucursal B sigue intacta.
    const enB = await InsumoStock.findOne({
      where: { sucursalId: sucursalB.id, insumoId: insumo.id },
    });
    expect(enB.cantidad).toBe(8);

    const porTipo = await agenteAdmin.get('/api/stock/insumos?tipo=extra');
    expect(porTipo.statusCode).toBe(200);
    expect(porTipo.body.data).toHaveLength(0);

    const tipoInvalido = await agenteAdmin.get(
      '/api/stock/insumos?tipo=bebida'
    );
    expect(tipoInvalido.statusCode).toBe(400);
  });

  it('el superadmin necesita contexto para operar stock de insumos', async () => {
    const sinContexto = await agenteSuperadmin.get('/api/stock/insumos');
    expect(sinContexto.statusCode).toBe(403);

    const csrf = await obtenerCsrf(agenteSuperadmin);
    const contexto = await agenteSuperadmin
      .post('/api/auth/sucursal-contexto')
      .set('x-csrf-token', csrf)
      .send({ sucursalId: sucursalB.id });
    expect(contexto.statusCode).toBe(200);

    const listado = await agenteSuperadmin.get('/api/stock/insumos');
    expect(listado.statusCode).toBe(200);
    expect(listado.body.data).toHaveLength(1);
    expect(listado.body.data[0]).toMatchObject({
      sucursalId: sucursalB.id,
      cantidad: 8,
    });

    const actualizado = await pedir(
      agenteSuperadmin,
      'put',
      `/api/stock/insumos/${listado.body.data[0].insumoId}`,
      { disponible: false }
    );
    expect(actualizado.statusCode).toBe(200);
    expect(actualizado.body.data.disponible).toBe(false);
  });
});
