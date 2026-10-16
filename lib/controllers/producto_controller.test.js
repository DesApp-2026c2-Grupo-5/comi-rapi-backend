import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Categoria, PersonalizacionElemento, Producto } = db;

describe('Producto show (detalle)', () => {
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Prueba',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      descripcion: 'Medallón de carne, cheddar, lechuga y tomate.',
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    await PersonalizacionElemento.bulkCreate([
      {
        productoId: producto.id,
        tipo: 'personalizar',
        nombre: 'Lechuga',
        precio: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'extra',
        nombre: 'Cheddar',
        precio: 200,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'acompanar',
        nombre: 'Papas',
        precio: 350,
        productoReferenciaId: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'condimento',
        nombre: 'Ketchup',
        precio: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'extra',
        nombre: 'Dado de baja',
        precio: 999,
        activo: false,
      },
    ]);
  });

  test('show incluye personalización activa con sus campos', async () => {
    const res = await request(app).get(`/api/productos/${producto.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nombre).toBe('Hamburguesa Clásica');
    expect(res.body.data.categoria).toBe('Hamburguesas');
    const nombres = res.body.data.personalizacion.map((e) => e.nombre);
    expect(nombres).toEqual(
      expect.arrayContaining(['Lechuga', 'Cheddar', 'Papas', 'Ketchup'])
    );
    expect(nombres).not.toContain('Dado de baja');
    const cheddar = res.body.data.personalizacion.find(
      (e) => e.nombre === 'Cheddar'
    );
    expect(cheddar).toMatchObject({ tipo: 'extra', precio: 200 });
  });

  test('show de producto inexistente responde 404', async () => {
    const res = await request(app).get('/api/productos/999999');
    expect(res.statusCode).toBe(404);
  });
});
