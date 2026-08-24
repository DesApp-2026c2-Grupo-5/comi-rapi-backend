const request = require('supertest');
const { cleanDb } = require('../../test/db_utils');
const app = require('../app');
const Usuario = require('../models/usuario');

describe('Usuario controller', () => {
  beforeAll(async () => {
    await cleanDb();

    await Usuario.bulkCreate([
      { nombre: 'Pepita', apellido: 'La pistolera' },
      { nombre: 'Juana', apellido: 'Azurduy' },
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
