import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../app';
import db from '../models';
import config from '../config/config';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import { eliminarImagenEnCarpeta } from '../services/imagen_upload_service';

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);

let clienteId;
let otroId;

const CLIENTE = {
  nombre: 'Cliente',
  apellido: 'Prueba',
  email: 'cliente-perfil@test.com',
  password: '123456',
  telefono: '1155555555',
  fechaNacimiento: '1995-03-10',
};

const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function registrarYLoguear(agente, email, rol) {
  await crearUsuario({ email, rol });
  const csrf2 = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ email, password: '123456' });
  const me = await agente.get('/api/auth/me');
  return me.body.data.id;
}

describe('Perfil controller', () => {
  beforeAll(async () => {
    await cleanDb();
    clienteId = await registrarYLoguear(
      agenteCliente,
      CLIENTE.email,
      'CLIENTE'
    );
    otroId = await registrarYLoguear(
      agenteOtro,
      'otro-perfil@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-perfil@test.com',
      'ADMINISTRADOR'
    );
  });

  // Restaura el cliente principal a su estado original. Se pasa el password por
  // instancia (no bulk update) para que el hook beforeSave aplique Argon2id.
  beforeEach(async () => {
    const usuario = await db.Usuario.findByPk(clienteId);
    if (usuario.fotoPerfilUrl) {
      eliminarImagenEnCarpeta(
        config.imagenes.perfilesDir,
        usuario.fotoPerfilUrl
      );
    }
    await usuario.update({
      nombre: CLIENTE.nombre,
      apellido: CLIENTE.apellido,
      email: CLIENTE.email,
      telefono: CLIENTE.telefono,
      fechaNacimiento: CLIENTE.fechaNacimiento,
      fotoPerfilUrl: null,
      password: CLIENTE.password,
    });
  });

  afterAll(() => {
    const dir = config.imagenes.perfilesDir;
    if (fs.existsSync(dir)) {
      for (const archivo of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, archivo));
      }
    }
  });

  describe('GET /api/perfil', () => {
    it('devuelve exactamente los campos del perfil, sin datos sensibles', async () => {
      const res = await agenteCliente.get('/api/perfil');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: clienteId,
        nombre: CLIENTE.nombre,
        apellido: CLIENTE.apellido,
        email: CLIENTE.email,
        telefono: CLIENTE.telefono,
        fechaNacimiento: CLIENTE.fechaNacimiento,
        fotoPerfilUrl: null,
      });
      expect(res.body.data.password).toBeUndefined();
      expect(res.body.data.rol).toBeUndefined();
      expect(res.body.data.activo).toBeUndefined();
    });

    it('rechaza peticiones sin sesión', async () => {
      const anon = request(app);
      const res = await anon.get('/api/perfil');
      expect(res.status).toBe(401);
    });

    it('rechaza a otros roles (403)', async () => {
      const res = await agenteAdmin.get('/api/perfil');
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/perfil', () => {
    it('actualiza telefono, fecha de nacimiento y email', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({
          telefono: '1166666666',
          fechaNacimiento: '1990-01-02',
          email: '  Cliente-Perfil@Test.com  ',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.telefono).toBe('1166666666');
      expect(res.body.data.fechaNacimiento).toBe('1990-01-02');
      expect(res.body.data.email).toBe('cliente-perfil@test.com');

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.telefono).toBe('1166666666');
      expect(usuario.rol).toBe('CLIENTE');
    });

    it('mantiene nombre y apellido aunque se envíen en el PUT', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Nuevo',
          apellido: 'Apellido',
          telefono: '1166666666',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('no puede modificarse');

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.nombre).toBe(CLIENTE.nombre);
      expect(usuario.apellido).toBe(CLIENTE.apellido);
      // El rechazo es del PUT completo: no se aplica el resto de los campos.
      expect(usuario.telefono).toBe(CLIENTE.telefono);
    });

    it('normaliza el email (trim + lowercase)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ email: '  NUEVO-EMAIL@TEST.COM  ' });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('nuevo-email@test.com');
    });

    it('no deja tomar el email de otra cuenta (error genérico)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ email: 'otro-perfil@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No se pudo completar la operación');

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.email).toBe(CLIENTE.email);
    });

    it.each([
      'id',
      'usuarioId',
      'rol',
      'activo',
      'password',
      'nombre',
      'apellido',
    ])('rechaza intentar modificar %s', async (campo) => {
      const antes = await db.Usuario.findByPk(clienteId);
      const csrf = await obtenerCsrf(agenteCliente);
      const valor =
        campo === 'usuarioId' ? otroId : campo === 'id' ? 999 : 'nuevo-valor';
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ [campo]: valor });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('no puede modificarse');

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.rol).toBe('CLIENTE');
      expect(usuario.activo).toBe(true);
      expect(usuario.get(campo)).toBe(antes.get(campo));
    });

    it('no altera los datos de otros usuarios', async () => {
      const otroAntes = await db.Usuario.findByPk(otroId);
      const csrf = await obtenerCsrf(agenteCliente);
      await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ telefono: '1199999999' });

      const otro = await db.Usuario.findByPk(otroId);
      expect(otro.telefono).toBe(otroAntes.telefono);
      expect(otro.nombre).toBe('Test');
    });

    it('rechaza email vacío o mal formado', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const malFormado = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ email: 'no-es-email' });
      const csrf2 = await obtenerCsrf(agenteCliente);
      const vacio = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf2)
        .send({ email: '' });

      expect(malFormado.status).toBe(400);
      expect(vacio.status).toBe(400);
    });

    it('rechaza una fecha de nacimiento inválida y acepta vaciarla', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const invalida = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({ fechaNacimiento: '31-12-1999' });

      expect(invalida.status).toBe(400);

      const csrf2 = await obtenerCsrf(agenteCliente);
      const vaciada = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf2)
        .send({ fechaNacimiento: '' });
      expect(vaciada.status).toBe(200);
      expect(vaciada.body.data.fechaNacimiento).toBeNull();
    });

    it('un PUT sin campos editables responde el perfil sin alterar nada', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put('/api/perfil')
        .set('x-csrf-token', csrf)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.nombre).toBe(CLIENTE.nombre);
    });
  });

  describe('POST /api/perfil/foto', () => {
    it('sube una imagen y la persiste en el perfil', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf)
        .attach('imagen', PNG_MINIMO, {
          filename: 'avatar.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(201);
      const url = res.body.data.url;
      expect(url).toMatch(/^\/imagenes\/perfiles\/avatar-.*\.png$/);

      const archivo = path.join(
        config.imagenes.perfilesDir,
        path.basename(url)
      );
      expect(fs.existsSync(archivo)).toBe(true);

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.fotoPerfilUrl).toBe(url);
    });

    it('reemplaza la foto anterior y borra el archivo viejo', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const primera = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf)
        .attach('imagen', PNG_MINIMO, {
          filename: 'avatar.png',
          contentType: 'image/png',
        });
      const urlPrimera = primera.body.data.url;

      await new Promise((resolve) => setTimeout(resolve, 20));
      const csrf2 = await obtenerCsrf(agenteCliente);
      const segunda = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf2)
        .attach('imagen', PNG_MINIMO, {
          filename: 'avatar.png',
          contentType: 'image/png',
        });
      const urlSegunda = segunda.body.data.url;

      expect(urlPrimera).not.toBe(urlSegunda);
      expect(
        fs.existsSync(
          path.join(config.imagenes.perfilesDir, path.basename(urlPrimera))
        )
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(config.imagenes.perfilesDir, path.basename(urlSegunda))
        )
      ).toBe(true);
    });

    it('expone la foto en la sesión para el avatar del navbar', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const subida = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf)
        .attach('imagen', PNG_MINIMO, {
          filename: 'avatar.png',
          contentType: 'image/png',
        });

      // El navbar dibuja el avatar con el usuario de la sesión, sin pedir /perfil.
      const me = await agenteCliente.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data.fotoPerfilUrl).toBe(subida.body.data.url);
      expect(me.body.data).not.toHaveProperty('password');
    });

    it('responde 400 sin archivo', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No se recibió ninguna imagen');
    });

    it('rechaza un archivo que no es imagen', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf)
        .attach('imagen', Buffer.from('no es una imagen'), {
          filename: 'nota.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('imagen');
    });
  });

  describe('DELETE /api/perfil/foto', () => {
    it('elimina la foto y borra el archivo', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const subida = await agenteCliente
        .post('/api/perfil/foto')
        .set('x-csrf-token', csrf)
        .attach('imagen', PNG_MINIMO, {
          filename: 'avatar.png',
          contentType: 'image/png',
        });
      const url = subida.body.data.url;

      const csrf2 = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .delete('/api/perfil/foto')
        .set('x-csrf-token', csrf2);

      expect(res.status).toBe(200);
      expect(res.body.data.fotoPerfilUrl).toBeNull();
      // La respuesta es el perfil completo, igual que en el PUT.
      expect(res.body.data.email).toBe(CLIENTE.email);
      expect(res.body.data).not.toHaveProperty('password');
      expect(
        fs.existsSync(
          path.join(config.imagenes.perfilesDir, path.basename(url))
        )
      ).toBe(false);

      const usuario = await db.Usuario.findByPk(clienteId);
      expect(usuario.fotoPerfilUrl).toBeNull();
    });

    it('es idempotente si no hay foto', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .delete('/api/perfil/foto')
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(200);
      expect(res.body.data.fotoPerfilUrl).toBeNull();
    });
  });

  describe('POST /api/perfil/cambiar-password', () => {
    it('rechaza una contraseña actual incorrecta', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/cambiar-password')
        .set('x-csrf-token', csrf)
        .send({
          passwordActual: 'incorrecta',
          password: 'nueva123',
          confirmPassword: 'nueva123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('La contraseña actual es incorrecta.');
    });

    it('rechaza contraseñas que no coinciden', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/cambiar-password')
        .set('x-csrf-token', csrf)
        .send({
          passwordActual: '123456',
          password: 'nueva123',
          confirmPassword: 'otra123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Las contraseñas no coinciden.');
    });

    it('rechaza una contraseña nueva demasiado corta', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/cambiar-password')
        .set('x-csrf-token', csrf)
        .send({
          passwordActual: '123456',
          password: '123',
          confirmPassword: '123',
        });

      expect(res.status).toBe(400);
    });

    it('cambia la contraseña, mantiene la sesión actual e invalida el login viejo', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/perfil/cambiar-password')
        .set('x-csrf-token', csrf)
        .send({
          passwordActual: '123456',
          password: 'nueva123',
          confirmPassword: 'nueva123',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe(
        'Contraseña actualizada correctamente.'
      );

      // La sesión desde la que se cambió la contraseña sigue vigente.
      const me = await agenteCliente.get('/api/auth/me');
      expect(me.status).toBe(200);

      // El login con la contraseña vieja deja de funcionar.
      const csrfViejo = await obtenerCsrf(agenteCliente);
      const loginVieja = await agenteCliente
        .post('/api/auth/login')
        .set('x-csrf-token', csrfViejo)
        .send({ email: CLIENTE.email, password: '123456' });
      expect(loginVieja.status).toBe(401);

      // El login con la nueva contraseña funciona.
      const csrfNuevo = await obtenerCsrf(agenteCliente);
      const loginNueva = await agenteCliente
        .post('/api/auth/login')
        .set('x-csrf-token', csrfNuevo)
        .send({ email: CLIENTE.email, password: 'nueva123' });
      expect(loginNueva.status).toBe(200);
    });

    it('limita los intentos por usuario para que no se adivine la contraseña actual', async () => {
      // El contador del limitador es por usuario, así que se usa el segundo
      // cliente: el primero ya viene de arrastrar los intentos del describe.
      const habilitadoOriginal = config.rateLimit.enabled;
      config.rateLimit.enabled = true;
      try {
        const max = config.perfil.rateLimitPassword.max;

        for (let i = 0; i < max; i += 1) {
          const csrf = await obtenerCsrf(agenteOtro);
          const intento = await agenteOtro
            .post('/api/perfil/cambiar-password')
            .set('x-csrf-token', csrf)
            .send({
              passwordActual: `incorrecta${i}`,
              password: 'nueva123',
              confirmPassword: 'nueva123',
            });
          expect(intento.status).toBe(400);
        }

        const csrf = await obtenerCsrf(agenteOtro);
        const bloqueado = await agenteOtro
          .post('/api/perfil/cambiar-password')
          .set('x-csrf-token', csrf)
          .send({
            passwordActual: '123456',
            password: 'nueva123',
            confirmPassword: 'nueva123',
          });

        // Aunque sea la contraseña correcta, el límite se adelanta al cambio.
        expect(bloqueado.status).toBe(429);
        expect(bloqueado.body.error).toBe(
          'Demasiados intentos de cambio de contraseña. Intente nuevamente más tarde.'
        );

        // La del segundo cliente nunca se cambió.
        const yo = await db.Usuario.findByPk(otroId);
        expect(await yo.verificarPassword('123456')).toBe(true);
      } finally {
        config.rateLimit.enabled = habilitadoOriginal;
      }
    });
  });
});
