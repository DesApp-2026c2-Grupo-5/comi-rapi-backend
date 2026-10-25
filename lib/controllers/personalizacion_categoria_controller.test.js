/**
 * Pruebas de las plantillas de personalización por categoría.
 *
 * Cubren el CRUD (con permisos de SUPERADMINISTRADOR) y la copia automática de
 * las plantillas activas cuando se crea un producto de la categoría.
 */
import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const {
  Categoria,
  PersonalizacionCategoria,
  PersonalizacionElemento,
  Producto,
} = db;

const agente = request.agent(app);

async function obtenerCsrf() {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function login(email, password = '123456') {
  const csrf = await obtenerCsrf();
  return agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
}

describe('Personalización por categoría', () => {
  let categoriaBebidas;
  let categoriaHamburguesas;
  let productoReferencia;

  beforeAll(async () => {
    await cleanDb();
    categoriaBebidas = await Categoria.create({ nombre: 'Bebidas' });
    categoriaHamburguesas = await Categoria.create({ nombre: 'Hamburguesas' });
    productoReferencia = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: categoriaHamburguesas.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    await crearUsuario({
      email: 'super-categorias@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    const res = await login('super-categorias@test.com');
    if (res.statusCode !== 200) {
      throw new Error(`El login del superadmin falló: ${res.statusCode}`);
    }
  });

  beforeEach(async () => {
    // Cada test arranca sin plantillas ni elementos copiados; las categorías y
    // los productos de referencia se conservan.
    await PersonalizacionElemento.destroy({ where: {} });
    await PersonalizacionCategoria.destroy({ where: {} });
  });

  test('crea una plantilla de tipo personalizar y la lista por categoría', async () => {
    const csrf = await obtenerCsrf();
    const creacion = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'personalizar',
        nombre: 'Hielo',
        minimo: 0,
        maximo: 1,
      });

    expect(creacion.statusCode).toBe(201);
    expect(creacion.body.data).toMatchObject({
      categoriaId: categoriaBebidas.id,
      tipo: 'personalizar',
      nombre: 'Hielo',
      precio: null,
      activo: true,
    });

    const listado = await agente.get(
      `/api/personalizacion/categorias?categoriaId=${categoriaBebidas.id}`
    );
    expect(listado.statusCode).toBe(200);
    expect(listado.body.data).toHaveLength(1);
    expect(listado.body.data[0].nombre).toBe('Hielo');
  });

  test('rechaza una plantilla duplicada de la misma categoría y tipo', async () => {
    const csrf = await obtenerCsrf();
    const datos = {
      categoriaId: categoriaBebidas.id,
      tipo: 'extra',
      nombre: 'Bacon',
      precio: 500,
    };
    const primera = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send(datos);
    expect(primera.statusCode).toBe(201);

    const duplicada = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send(datos);
    expect(duplicada.statusCode).toBe(400);
    expect(duplicada.body.success).toBe(false);
  });

  test('PUT parcial { minimo, maximo } conserva el resto de la plantilla', async () => {
    const csrf = await obtenerCsrf();
    const creacion = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'extra',
        nombre: 'Limón',
        precio: 300,
      });
    const plantilla = creacion.body.data;

    const res = await agente
      .put(`/api/personalizacion/categorias/${plantilla.id}`)
      .set('x-csrf-token', csrf)
      .send({ minimo: 1, maximo: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ minimo: 1, maximo: 3 });
    expect(res.body.data.nombre).toBe('Limón');
    expect(Number(res.body.data.precio)).toBe(300);
  });

  test('crea un acompañamiento con producto de referencia', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaHamburguesas.id,
        tipo: 'acompanar',
        nombre: 'Hamburguesa Clásica',
        precio: 1400,
        productoReferenciaId: productoReferencia.id,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.productoReferenciaId).toBe(productoReferencia.id);
  });

  test('al crear un producto copia las plantillas de su categoría salvo ingredientes', async () => {
    const csrf = await obtenerCsrf();
    await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'personalizar',
        nombre: 'Hielo',
      });
    await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'extra',
        nombre: 'Limón',
        precio: 300,
      });

    const creacion = await agente
      .post('/api/productos')
      .set('x-csrf-token', csrf)
      .send({
        nombre: 'Agua mineral',
        precio: 1000,
        categoriaId: categoriaBebidas.id,
        tipo: 'PRODUCTO',
      });

    expect(creacion.statusCode).toBe(201);
    const elementos = await PersonalizacionElemento.findAll({
      where: { productoId: creacion.body.data.id },
      order: [['id', 'ASC']],
    });
    // El extra se hereda; los ingredientes (`personalizar`) no.
    expect(elementos).toHaveLength(1);
    expect(elementos[0].nombre).toBe('Limón');
  });

  test('crea un producto con los ingredientes indicados y sin genéricos', async () => {
    const csrf = await obtenerCsrf();
    await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'personalizar',
        nombre: 'Hielo',
      });

    const creacion = await agente
      .post('/api/productos')
      .set('x-csrf-token', csrf)
      .send({
        nombre: 'Limonada',
        precio: 1200,
        categoriaId: categoriaBebidas.id,
        tipo: 'PRODUCTO',
        ingredientes: ['Agua', 'Limón', '  Azúcar  ', 'limón'],
      });

    expect(creacion.statusCode).toBe(201);
    const elementos = await PersonalizacionElemento.findAll({
      where: { productoId: creacion.body.data.id, tipo: 'personalizar' },
      order: [['id', 'ASC']],
    });
    // Se recortan espacios y se descartan repetidos sin distinguir mayúsculas.
    expect(elementos.map((e) => e.nombre)).toEqual(['Agua', 'Limón', 'Azúcar']);
    expect(elementos.every((e) => e.activo)).toBe(true);
  });

  test('editar un producto reemplaza sus ingredientes y permite dejarlo sin ninguno', async () => {
    const csrf = await obtenerCsrf();
    const creacion = await agente
      .post('/api/productos')
      .set('x-csrf-token', csrf)
      .send({
        nombre: 'Tostado',
        precio: 800,
        categoriaId: categoriaHamburguesas.id,
        tipo: 'PRODUCTO',
        ingredientes: ['Pan', 'Jamón'],
      });
    expect(creacion.statusCode).toBe(201);

    const edicion = await agente
      .put(`/api/productos/${creacion.body.data.id}`)
      .set('x-csrf-token', csrf)
      .send({ ingredientes: ['Pan', 'Queso'] });
    expect(edicion.statusCode).toBe(200);

    const conQueso = await PersonalizacionElemento.findAll({
      where: { productoId: creacion.body.data.id, tipo: 'personalizar' },
      order: [['id', 'ASC']],
    });
    expect(conQueso.map((e) => e.nombre)).toEqual(['Pan', 'Queso']);

    const vaciado = await agente
      .put(`/api/productos/${creacion.body.data.id}`)
      .set('x-csrf-token', csrf)
      .send({ ingredientes: [] });
    expect(vaciado.statusCode).toBe(200);

    const sinIngredientes = await PersonalizacionElemento.findAll({
      where: { productoId: creacion.body.data.id, tipo: 'personalizar' },
    });
    expect(sinIngredientes).toHaveLength(0);
  });

  test('rechaza ingredientes en un combo', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/productos')
      .set('x-csrf-token', csrf)
      .send({
        nombre: 'Combo con ingredientes',
        precio: 1000,
        tipo: 'COMBO',
        ingredientes: ['Pan'],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('una plantilla inactiva no se copia al crear un producto', async () => {
    const csrf = await obtenerCsrf();
    const creacion = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'personalizar',
        nombre: 'Azúcar',
        activo: false,
      });
    expect(creacion.statusCode).toBe(201);

    const producto = await agente
      .post('/api/productos')
      .set('x-csrf-token', csrf)
      .send({
        nombre: 'Café',
        precio: 900,
        categoriaId: categoriaBebidas.id,
        tipo: 'PRODUCTO',
      });
    expect(producto.statusCode).toBe(201);

    const elementos = await PersonalizacionElemento.findAll({
      where: { productoId: producto.body.data.id },
    });
    expect(elementos).toHaveLength(0);
  });

  test('DELETE hace baja lógica (activo = false)', async () => {
    const csrf = await obtenerCsrf();
    const creacion = await agente
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'condimento',
        nombre: 'Sobre de Ketchup',
      });
    const plantilla = creacion.body.data;

    const res = await agente
      .delete(`/api/personalizacion/categorias/${plantilla.id}`)
      .set('x-csrf-token', csrf);
    expect(res.statusCode).toBe(200);

    const enBase = await PersonalizacionCategoria.findByPk(plantilla.id);
    expect(enBase.activo).toBe(false);
  });

  test('rechaza (403) a un usuario que no es SUPERADMINISTRADOR', async () => {
    await crearUsuario({
      email: 'admin-categorias@test.com',
      rol: 'ADMINISTRADOR',
    });
    const agenteAdmin = request.agent(app);
    const csrfLogin = await agenteAdmin.get('/api/auth/csrf-token');
    await agenteAdmin
      .post('/api/auth/login')
      .set('x-csrf-token', csrfLogin.body.data.csrfToken)
      .send({ email: 'admin-categorias@test.com', password: '123456' });
    const csrf = await agenteAdmin.get('/api/auth/csrf-token');

    const res = await agenteAdmin
      .post('/api/personalizacion/categorias')
      .set('x-csrf-token', csrf.body.data.csrfToken)
      .send({
        categoriaId: categoriaBebidas.id,
        tipo: 'extra',
        nombre: 'Queso',
        precio: 200,
      });

    expect(res.statusCode).toBe(403);
  });
});
