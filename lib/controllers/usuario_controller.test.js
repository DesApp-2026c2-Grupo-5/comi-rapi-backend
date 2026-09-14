import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import Usuario from '../models/usuario';

describe('Usuario controller', () => {
  beforeAll(async () => {
    await cleanDb();

    await Usuario.bulkCreate([
      {
        nombre: 'Pepita',
        apellido: 'La pistolera',
        email: 'pepita@test.com',
        password: '123456',
        rol: 'CLIENTE',
        activo: true,
      },
      {
        nombre: 'Juana',
        apellido: 'Azurduy',
        email: 'juana@test.com',
        password: '123456',
        rol: 'CLIENTE',
        activo: true,
      },
    ]);
  });
  describe('/usuarios', () => {
    let response;

    beforeAll(async () => {
      response = await request(app).get('/api/usuarios');
    });

    it('devuelve código 200', () => {
      expect(response.statusCode).toBe(200);
    });

    it('devuelve la lista de usuarios', () => {
      // Usamos toMatchObject y no toEquals para que solo mire los atributos que especificamos.
      expect(response.body).toMatchObject({
        data: [
          { nombre: 'Pepita', apellido: 'La pistolera' },
          { nombre: 'Juana', apellido: 'Azurduy' },
        ],
      });
    });
  });
});
