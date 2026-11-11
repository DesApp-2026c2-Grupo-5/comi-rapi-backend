/**
 * Pruebas HTTP del catálogo de ingredientes.
 *
 * El catálogo lo escribe sólo el SUPERADMINISTRADOR; la lectura es pública y
 * sólo muestra los activos. La unidad no se puede cambiar cuando ya hay stock
 * positivo o recetas que la usan.
 */
import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';
import {
  IngredienteInvalidoError,
  normalizarDatosIngrediente,
} from '../services/ingredientes_catalogo';

const {
  Categoria,
  Ingrediente,
  IngredienteStock,
  Producto,
  ProductoIngrediente,
  Sucursal,
} = db;

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

describe('normalizarDatosIngrediente', () => {
  test('normaliza nombre y unidad', () => {
    expect(
      normalizarDatosIngrediente({ nombre: ' Tomate ', unidadMedida: 'G' })
    ).toEqual({ nombre: 'Tomate', unidadMedida: 'g' });
  });

  test('rechaza nombre vacío y unidad inválida', () => {
    expect(() =>
      normalizarDatosIngrediente({ nombre: '  ', unidadMedida: 'g' })
    ).toThrow(IngredienteInvalidoError);
    expect(() =>
      normalizarDatosIngrediente({ nombre: 'Tomate', unidadMedida: 'taza' })
    ).toThrow('La unidad de medida debe ser unidad, g, kg, ml o l');
  });
});

describe('Ingredientes: catálogo', () => {
  let sucursalA;
  let categoria;

  beforeAll(async () => {
    await cleanDb();
    [sucursalA] = await Sucursal.bulkCreate([
      { nombre: 'Sucursal A', activa: true },
      { nombre: 'Sucursal B', activa: true },
    ]);
    categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    await crearUsuario({
      email: 'admin-ingredientes@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursalA.id,
    });
    await crearUsuario({
      email: 'superadmin-ingredientes@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    await loguear(agenteAdmin, 'admin-ingredientes@test.com');
    await loguear(agenteSuperadmin, 'superadmin-ingredientes@test.com');
  });

  it('el admin no puede crear ingredientes', async () => {
    const res = await pedir(agenteAdmin, 'post', '/api/ingredientes', {
      nombre: 'Tomate',
      unidadMedida: 'g',
    });
    expect(res.statusCode).toBe(403);
  });

  it('el superadmin da de alta un ingrediente con stock 0 en cada sucursal', async () => {
    const res = await pedir(agenteSuperadmin, 'post', '/api/ingredientes', {
      nombre: 'Tomate',
      unidadMedida: 'g',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({
      nombre: 'Tomate',
      unidadMedida: 'g',
      activo: true,
      enUso: false,
      recetas: 0,
      stockTotal: 0,
    });

    const filas = await IngredienteStock.findAll({
      where: { ingredienteId: res.body.data.id },
    });
    expect(filas).toHaveLength(2);
    expect(filas.every((fila) => Number(fila.cantidad) === 0)).toBe(true);
  });

  it('valida nombre duplicado y unidad inválida', async () => {
    const duplicado = await pedir(
      agenteSuperadmin,
      'post',
      '/api/ingredientes',
      { nombre: 'tomate', unidadMedida: 'g' }
    );
    expect(duplicado.statusCode).toBe(409);

    const unidadInvalida = await pedir(
      agenteSuperadmin,
      'post',
      '/api/ingredientes',
      { nombre: 'Leche', unidadMedida: 'taza' }
    );
    expect(unidadInvalida.statusCode).toBe(400);
  });

  it('el listado público sólo trae activos', async () => {
    const lechuga = await pedir(agenteSuperadmin, 'post', '/api/ingredientes', {
      nombre: 'Lechuga',
      unidadMedida: 'g',
    });
    expect(lechuga.statusCode).toBe(201);

    const baja = await pedir(
      agenteSuperadmin,
      'delete',
      `/api/ingredientes/${lechuga.body.data.id}`
    );
    expect(baja.statusCode).toBe(200);

    const publico = await request(app).get('/api/ingredientes');
    expect(publico.statusCode).toBe(200);
    expect(publico.body.data.map((i) => i.nombre)).toEqual(['Tomate']);

    const gestion = await agenteSuperadmin.get(
      '/api/ingredientes?activo=false'
    );
    expect(gestion.statusCode).toBe(200);
    expect(gestion.body.data.map((i) => i.nombre)).toEqual(['Lechuga']);
  });

  it('permite cambiar la unidad si todavía no hay stock ni recetas', async () => {
    const creado = await pedir(agenteSuperadmin, 'post', '/api/ingredientes', {
      nombre: 'Papa',
      unidadMedida: 'unidad',
    });
    const editado = await pedir(
      agenteSuperadmin,
      'put',
      `/api/ingredientes/${creado.body.data.id}`,
      { unidadMedida: 'g' }
    );
    expect(editado.statusCode).toBe(200);
    expect(editado.body.data.unidadMedida).toBe('g');
  });

  it('bloquea el cambio de unidad si el ingrediente tiene stock positivo', async () => {
    const creado = await pedir(agenteSuperadmin, 'post', '/api/ingredientes', {
      nombre: 'Carne',
      unidadMedida: 'g',
    });
    await IngredienteStock.update(
      { cantidad: 1000 },
      {
        where: { ingredienteId: creado.body.data.id, sucursalId: sucursalA.id },
      }
    );

    const editado = await pedir(
      agenteSuperadmin,
      'put',
      `/api/ingredientes/${creado.body.data.id}`,
      { unidadMedida: 'kg' }
    );
    expect(editado.statusCode).toBe(409);
    expect(editado.body.error).toMatch(/stock o recetas/);

    const listado = await agenteSuperadmin.get('/api/ingredientes');
    const fila = listado.body.data.find((i) => i.id === creado.body.data.id);
    expect(fila.unidadMedida).toBe('g');
    expect(fila.stockTotal).toBe(1000);
  });

  it('bloquea el cambio de unidad si el ingrediente está en una receta', async () => {
    const creado = await pedir(agenteSuperadmin, 'post', '/api/ingredientes', {
      nombre: 'Cheddar',
      unidadMedida: 'g',
    });
    const producto = await Producto.create({
      nombre: 'Hamburguesa',
      precio: 1000,
      categoriaId: categoria.id,
      tipo: 'PRODUCTO',
    });
    await ProductoIngrediente.create({
      productoId: producto.id,
      ingredienteId: creado.body.data.id,
      cantidad: 20,
    });

    const editado = await pedir(
      agenteSuperadmin,
      'put',
      `/api/ingredientes/${creado.body.data.id}`,
      { nombre: 'Queso cheddar' }
    );
    expect(editado.statusCode).toBe(200);
    expect(editado.body.data).toMatchObject({
      nombre: 'Queso cheddar',
      enUso: true,
      recetas: 1,
    });

    const cambioUnidad = await pedir(
      agenteSuperadmin,
      'put',
      `/api/ingredientes/${creado.body.data.id}`,
      { unidadMedida: 'unidad' }
    );
    expect(cambioUnidad.statusCode).toBe(409);
  });

  it('devuelve 404 para un ingrediente inexistente', async () => {
    const res = await request(app).get('/api/ingredientes/999999');
    expect(res.statusCode).toBe(404);
  });

  it('el stock se conserva tras la baja lógica', async () => {
    const ingrediente = await Ingrediente.findOne({
      where: { nombre: 'Carne' },
    });
    await pedir(
      agenteSuperadmin,
      'delete',
      `/api/ingredientes/${ingrediente.id}`
    );
    const filas = await IngredienteStock.count({
      where: { ingredienteId: ingrediente.id },
    });
    expect(filas).toBe(2);
  });
});
