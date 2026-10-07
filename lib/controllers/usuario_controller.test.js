import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';
import Usuario from '../models/usuario';

const agenteAdmin = request.agent(app);

// Sucursal del admin del test: la acotación de la lista de clientes se hace
// contra esta sucursal, así que tiene que existir antes de loguear al admin.
let sucursalAdmin;
let sucursalOtra;

async function obtenerCsrf() {
  const res = await agenteAdmin.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function crearAdmin() {
  sucursalAdmin = await db.Sucursal.create({ nombre: 'Sucursal Admin' });
  sucursalOtra = await db.Sucursal.create({ nombre: 'Sucursal Otra' });
  await crearUsuario({
    nombre: 'Administradora',
    apellido: 'Del Sistema',
    email: 'adminsistema@test.com',
    password: '123456',
    rol: 'ADMINISTRADOR',
    sucursalId: sucursalAdmin.id,
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

    // Pedidos: Pepita tiene 2 en la sucursal del admin (y 1 en la otra, para
    // verificar que el conteo del admin sólo suma su sucursal). Juana solo
    // pidió en la otra sucursal, así que para el admin no aparece.
    const estado = await db.EstadoPedido.create({
      nombre: 'pendiente',
      orden: 1,
    });
    const pepita = await Usuario.findOne({
      where: { email: 'pepita@test.com' },
    });
    const juana = await Usuario.findOne({
      where: { email: 'juana@test.com' },
    });
    await db.Pedido.bulkCreate([
      {
        usuarioId: pepita.id,
        sucursalId: sucursalAdmin.id,
        estadoId: estado.id,
        total: 100,
      },
      {
        usuarioId: pepita.id,
        sucursalId: sucursalAdmin.id,
        estadoId: estado.id,
        total: 200,
      },
      {
        usuarioId: pepita.id,
        sucursalId: sucursalOtra.id,
        estadoId: estado.id,
        total: 300,
      },
      {
        usuarioId: juana.id,
        sucursalId: sucursalOtra.id,
        estadoId: estado.id,
        total: 400,
      },
    ]);
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

    it('devuelve la lista de clientes sin contraseñas (acotada a su sucursal)', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      expect(response.statusCode).toBe(200);

      // Solo CLIENTE con al menos un pedido en la sucursal del admin: Pepita
      // (2 pedidos ahí) aparece; Juana (solo pidió en otra sucursal) y el resto
      // del staff, no.
      const emails = response.body.data.map((u) => u.email);
      expect(emails).toContain('pepita@test.com');
      expect(emails).not.toContain('juana@test.com');
      expect(emails).not.toContain('adminsistema@test.com');
      expect(response.body.data.every((u) => u.rol === 'CLIENTE')).toBe(true);

      const serializado = JSON.stringify(response.body);
      expect(serializado).not.toContain('password');
      expect(serializado).not.toMatch(/\$argon2/);
    });

    it('cantidadPedidos cuenta solo los pedidos de la sucursal del admin', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=CLIENTE');
      const pepita = response.body.data.find(
        (u) => u.email === 'pepita@test.com'
      );
      expect(pepita).toMatchObject({ cantidadPedidos: 2, activo: true });
      expect(pepita).toHaveProperty('fotoPerfilUrl');
      expect(pepita).toHaveProperty('creadoEn');

      const serializado = JSON.stringify(response.body);
      expect(serializado).not.toContain('password');
      expect(serializado).not.toContain('fechaNacimiento');
      expect(serializado).not.toMatch(/\$argon2/);
    });

    it('filtra por rol=CLIENTE (dentro de su lista acotada)', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=CLIENTE');
      expect(response.statusCode).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data.every((u) => u.rol === 'CLIENTE')).toBe(true);
    });

    it('un admin no ve administradores aunque pida rol=ADMINISTRADOR', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=ADMINISTRADOR');
      expect(response.statusCode).toBe(200);
      // El filtro rol se ignora: la lista del admin siempre es de clientes con
      // pedidos en su sucursal, nunca otros administradores.
      expect(response.body.data.every((u) => u.rol === 'CLIENTE')).toBe(true);
      expect(response.body.data.map((u) => u.email)).not.toContain(
        'adminsistema@test.com'
      );
    });

    it('ignora el rol inválido y sigue acotado a clientes de su sucursal', async () => {
      const response = await agenteAdmin.get('/api/usuarios?rol=REPARTIDOR');
      expect(response.statusCode).toBe(200);
      expect(response.body.data.map((u) => u.email)).toEqual([
        'pepita@test.com',
      ]);
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

      const porApellido = await agenteAdmin.get(
        '/api/usuarios?buscar=pistolera'
      );
      expect(porApellido.body.data.map((u) => u.email)).toContain(
        'pepita@test.com'
      );

      // Un cliente sin pedidos en la sucursal del admin no aparece ni buscado.
      const juana = await agenteAdmin.get('/api/usuarios?buscar=azurduy');
      expect(juana.body.data).toHaveLength(0);
    });

    it('combina rol y búsqueda', async () => {
      const response = await agenteAdmin.get(
        '/api/usuarios?rol=CLIENTE&buscar=pepita@test.com'
      );
      expect(response.body.data.map((u) => u.email)).toEqual([
        'pepita@test.com',
      ]);
    });

    it('devuelve ordenado por nombre y apellido', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      const claves = response.body.data.map((u) => `${u.nombre} ${u.apellido}`);
      expect(claves).toEqual([...claves].sort((a, b) => a.localeCompare(b)));
    });

    it('el detalle de un cliente de la sucursal usa el formato de gestión', async () => {
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

    it('el admin no ve el detalle de un cliente sin pedidos en su sucursal (404)', async () => {
      const juana = await db.Usuario.findOne({
        where: { email: 'juana@test.com' },
      });
      const response = await agenteAdmin.get(`/api/usuarios/${juana.id}`);
      expect(response.statusCode).toBe(404);
    });

    it('el admin no ve el detalle de otro administrador (404)', async () => {
      const admin = await db.Usuario.findOne({
        where: { email: 'adminsistema@test.com' },
      });
      const response = await agenteAdmin.get(`/api/usuarios/${admin.id}`);
      expect(response.statusCode).toBe(404);
    });
  });
});

describe('Usuario controller — gestión por SUPERADMIN', () => {
  const agenteSuper = request.agent(app);
  let csrfSuper;
  let superadminId;
  let sucursalId;

  beforeAll(async () => {
    const superadmin = await crearUsuario({
      nombre: 'Super',
      apellido: 'Sistema',
      email: 'supersistema@test.com',
      password: '123456',
      rol: 'SUPERADMINISTRADOR',
    });
    superadminId = superadmin.id;

    const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Gestión' });
    sucursalId = sucursal.id;

    csrfSuper = (await agenteSuper.get('/api/auth/csrf-token')).body.data
      .csrfToken;
    await agenteSuper
      .post('/api/auth/login')
      .set('x-csrf-token', csrfSuper)
      .send({ email: 'supersistema@test.com', password: '123456' });
  });

  it('lista todos los usuarios registrados como SUPERADMIN (200)', async () => {
    const response = await agenteSuper.get('/api/usuarios');
    expect(response.statusCode).toBe(200);

    const emails = response.body.data.map((u) => u.email);
    expect(emails).toEqual(
      expect.arrayContaining([
        'pepita@test.com',
        'juana@test.com',
        'adminsistema@test.com',
        'supersistema@test.com',
      ])
    );
    const roles = new Set(response.body.data.map((u) => u.rol));
    expect([...roles]).toEqual(
      expect.arrayContaining(['CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'])
    );
  });

  it('un ADMINISTRADOR no puede crear usuarios (403)', async () => {
    const csrfAdmin = (await agenteAdmin.get('/api/auth/csrf-token')).body.data
      .csrfToken;
    const response = await agenteAdmin
      .post('/api/usuarios')
      .set('x-csrf-token', csrfAdmin)
      .send({
        nombre: 'X',
        email: 'x@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
    expect(response.statusCode).toBe(403);
  });

  it('crea un ADMINISTRADOR con sucursal', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Nuevo',
        apellido: 'Admin',
        email: 'nuevoadmin@test.com',
        password: '123456',
        rol: 'ADMINISTRADOR',
        sucursalId,
      });
    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      rol: 'ADMINISTRADOR',
      sucursalId,
    });
  });

  it('rechaza un ADMINISTRADOR sin sucursal (400)', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Sin',
        email: 'sinsuc@test.com',
        password: '123456',
        rol: 'ADMINISTRADOR',
      });
    expect(response.statusCode).toBe(400);
  });

  it('rechaza una sucursal inexistente (400)', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Mala',
        email: 'malasuc@test.com',
        password: '123456',
        rol: 'ADMINISTRADOR',
        sucursalId: 999999,
      });
    expect(response.statusCode).toBe(400);
  });

  it('crea un CLIENTE ignorando sucursalId', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Nuevo',
        email: 'nuevocliente@test.com',
        password: '123456',
        rol: 'CLIENTE',
        sucursalId,
      });
    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      rol: 'CLIENTE',
      sucursalId: null,
    });
  });

  it('rechaza un email duplicado (400)', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Dup',
        email: 'nuevocliente@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
    expect(response.statusCode).toBe(400);
  });

  it('crea un SUPERADMINISTRADOR por API (201)', async () => {
    const response = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Super2',
        email: 'super2@test.com',
        password: '123456',
        rol: 'SUPERADMINISTRADOR',
      });
    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      rol: 'SUPERADMINISTRADOR',
      sucursalId: null,
    });
  });

  it('cambia el rol de un cliente a ADMINISTRADOR y asigna sucursal', async () => {
    const creado = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Promo',
        email: 'promo@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
    const { id } = creado.body.data;

    const response = await agenteSuper
      .put(`/api/usuarios/${id}`)
      .set('x-csrf-token', csrfSuper)
      .send({ rol: 'ADMINISTRADOR', sucursalId });
    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      rol: 'ADMINISTRADOR',
      sucursalId,
    });
  });

  it('al pasar a CLIENTE limpia la sucursal', async () => {
    const creado = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Vuelve',
        email: 'vuelve@test.com',
        password: '123456',
        rol: 'ADMINISTRADOR',
        sucursalId,
      });
    const { id } = creado.body.data;

    const response = await agenteSuper
      .put(`/api/usuarios/${id}`)
      .set('x-csrf-token', csrfSuper)
      .send({ rol: 'CLIENTE' });
    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      rol: 'CLIENTE',
      sucursalId: null,
    });
  });

  it('promueve un administrador a SUPERADMINISTRADOR y limpia la sucursal', async () => {
    const creado = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Crecé',
        email: 'crece@test.com',
        password: '123456',
        rol: 'ADMINISTRADOR',
        sucursalId,
      });
    const { id } = creado.body.data;

    const response = await agenteSuper
      .put(`/api/usuarios/${id}`)
      .set('x-csrf-token', csrfSuper)
      .send({ rol: 'SUPERADMINISTRADOR' });
    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      rol: 'SUPERADMINISTRADOR',
      sucursalId: null,
    });
  });

  it('permite desactivar un usuario', async () => {
    const creado = await agenteSuper
      .post('/api/usuarios')
      .set('x-csrf-token', csrfSuper)
      .send({
        nombre: 'Baja',
        email: 'baja@test.com',
        password: '123456',
        rol: 'CLIENTE',
      });
    const { id } = creado.body.data;

    const response = await agenteSuper
      .put(`/api/usuarios/${id}`)
      .set('x-csrf-token', csrfSuper)
      .send({ activo: false });
    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({ activo: false });
  });

  it('no permite que el superadmin se cambie su propio rol (400)', async () => {
    const response = await agenteSuper
      .put(`/api/usuarios/${superadminId}`)
      .set('x-csrf-token', csrfSuper)
      .send({ rol: 'CLIENTE' });
    expect(response.statusCode).toBe(400);
  });

  it('devuelve 404 al editar un usuario inexistente', async () => {
    const response = await agenteSuper
      .put('/api/usuarios/999999')
      .set('x-csrf-token', csrfSuper)
      .send({ activo: false });
    expect(response.statusCode).toBe(404);
  });
});
