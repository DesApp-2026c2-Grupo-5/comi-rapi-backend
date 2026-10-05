import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';
import Usuario from '../models/usuario';

const agenteAdmin = request.agent(app);

async function obtenerCsrf() {
  const res = await agenteAdmin.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function crearAdmin() {
  const csrf = await obtenerCsrf();
  await agenteAdmin.post('/api/auth/registro').set('x-csrf-token', csrf).send({
    nombre: 'Administradora',
    apellido: 'Del Sistema',
    email: 'adminsistema@test.com',
    password: '123456',
    rol: 'ADMINISTRADOR',
  });
  const csrfLogin = await obtenerCsrf();
  await agenteAdmin
    .post('/api/auth/login')
    .set('x-csrf-token', csrfLogin)
    .send({ email: 'adminsistema@test.com', password: '123456' });
}

describe('Usuario controller', () => {
  beforeAll(async () => {
    await cleanDb();
    await crearAdmin();

    await Usuario.bulkCreate(
      [
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
      ],
      { individualHooks: true }
    );
  });

  describe('GET /api/usuarios', () => {
    it('responde 401 sin sesión', async () => {
      const agenteSuelto = request.agent(app);
      const response = await agenteSuelto.get('/api/usuarios');
      expect(response.statusCode).toBe(401);
    });

    it('responde 403 para un cliente autenticado', async () => {
      const agenteCliente = request.agent(app);
      const csrf1 = (await agenteCliente.get('/api/auth/csrf-token')).body.data
        .csrfToken;
      await agenteCliente
        .post('/api/auth/registro')
        .set('x-csrf-token', csrf1)
        .send({
          nombre: 'Cliente',
          email: 'clientetest@test.com',
          password: '123456',
        });
      const csrf2 = (await agenteCliente.get('/api/auth/csrf-token')).body.data
        .csrfToken;
      await agenteCliente
        .post('/api/auth/login')
        .set('x-csrf-token', csrf2)
        .send({ email: 'clientetest@test.com', password: '123456' });

      const response = await agenteCliente.get('/api/usuarios');
      expect(response.statusCode).toBe(403);
    });

    it('devuelve código 200 para un administrador', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      expect(response.statusCode).toBe(200);
    });

    it('devuelve la lista de usuarios sin contraseñas', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      expect(response.statusCode).toBe(200);

      const pepita = response.body.data.find(
        (u) => u.email === 'pepita@test.com'
      );
      const juana = response.body.data.find(
        (u) => u.email === 'juana@test.com'
      );
      expect(pepita).toMatchObject({
        nombre: 'Pepita',
        apellido: 'La pistolera',
      });
      expect(juana).toMatchObject({ nombre: 'Juana', apellido: 'Azurduy' });
      expect(response.body.data).toHaveLength(4);
      expect(response.body.data.every((u) => u.rol)).toBe(true);

      const serializado = JSON.stringify(response.body);
      expect(serializado).not.toContain('password');
      expect(serializado).not.toMatch(/\$argon2/);
    });

    it('filtra por rol=CLIENTE', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=CLIENTE');
      expect(response.statusCode).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data.every((u) => u.rol === 'CLIENTE')).toBe(true);
    });

    it('filtra por rol=ADMINISTRADOR', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=ADMINISTRADOR');
      expect(response.statusCode).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.every((u) => u.rol === 'ADMINISTRADOR')).toBe(
        true
      );
    });

    it('ignora un rol inválido y devuelve todo', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=REPARTIDOR');
      expect(response.statusCode).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('busca por nombre, apellido o email sin distinguir mayúsculas', async () => {
      const porNombre = await agenteAdmin.get('/api/usuarios?buscar=pepita');
      expect(porNombre.body.data.map((u) => u.email)).toContain(
        'pepita@test.com'
      );

      const enMayusculas = await agenteAdmin.get('/api/usuarios?buscar=PEPITA');
      expect(enMayusculas.body.data.map((u) => u.email)).toContain(
        'pepita@test.com'
      );

      const porApellido = await agenteAdmin.get('/api/usuarios?buscar=azurduy');
      expect(porApellido.body.data.map((u) => u.email)).toContain(
        'juana@test.com'
      );
    });

    it('combina rol y búsqueda', async () => {
      const response = await agenteAdmin.get(
        '/api/usuarios?rol=CLIENTE&buscar=juana@test.com'
      );
      expect(response.body.data.map((u) => u.email)).toEqual([
        'juana@test.com',
      ]);
    });

    it('devuelve ordenado por nombre y apellido', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      const claves = response.body.data.map((u) => `${u.nombre} ${u.apellido}`);
      expect(claves).toEqual([...claves].sort((a, b) => a.localeCompare(b)));
    });

    it('expone formato administración sin sensibles y con cantidadPedidos', async () => {
      const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Test' });
      const estado = await db.EstadoPedido.create({
        nombre: 'pendiente',
        orden: 1,
      });
      const pepita = await db.Usuario.findOne({
        where: { email: 'pepita@test.com' },
      });
      await db.Pedido.bulkCreate([
        {
          usuarioId: pepita.id,
          sucursalId: sucursal.id,
          estadoId: estado.id,
          total: 100,
        },
        {
          usuarioId: pepita.id,
          sucursalId: sucursal.id,
          estadoId: estado.id,
          total: 200,
        },
      ]);

      const response = await agenteAdmin.get('/api/usuarios?rol=CLIENTE');
      expect(response.statusCode).toBe(200);

      const pepitaJson = response.body.data.find(
        (u) => u.email === 'pepita@test.com'
      );
      expect(pepitaJson).toMatchObject({ cantidadPedidos: 2, activo: true });
      expect(pepitaJson).toHaveProperty('fotoPerfilUrl');
      expect(pepitaJson).toHaveProperty('creadoEn');

      const juanaJson = response.body.data.find(
        (u) => u.email === 'juana@test.com'
      );
      expect(juanaJson).toMatchObject({ cantidadPedidos: 0 });

      const serializado = JSON.stringify(response.body);
      expect(serializado).not.toContain('password');
      expect(serializado).not.toContain('fechaNacimiento');
      expect(serializado).not.toMatch(/\$argon2/);
    });

    it('el detalle usa el mismo formato', async () => {
      const pepita = await db.Usuario.findOne({
        where: { email: 'pepita@test.com' },
      });
      const response = await agenteAdmin.get(`/api/usuarios/${pepita.id}`);
      expect(response.statusCode).toBe(200);
      expect(response.body.data).toMatchObject({
        email: 'pepita@test.com',
        cantidadPedidos: 2,
      });
      expect(response.body.data).not.toHaveProperty('password');
      expect(response.body.data).not.toHaveProperty('fechaNacimiento');
    });
  });
});
