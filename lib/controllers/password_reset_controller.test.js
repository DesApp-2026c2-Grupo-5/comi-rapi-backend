import express from 'express';
import request from 'supertest';
import db from '../models';
import { cleanDb } from '../../test/db_utils';
import { forgotPassword, resetPassword } from './password_reset_controller';
import { generarToken, hashearToken } from '../services/password_reset_service';
import config from '../config/config';

const MENSAJE_SOLICITUD =
  'Si existe una cuenta asociada al email, recibirás un enlace para recuperar tu contraseña.';
const MENSAJE_TOKEN_GENERICO =
  'El enlace de recuperación no es válido o ya expiró.';

const crearUsuario = (overrides = {}) =>
  db.Usuario.create({
    nombre: 'Cliente',
    apellido: 'Prueba',
    email: 'cliente@test.com',
    password: 'original123',
    telefono: '1155555555',
    rol: 'CLIENTE',
    activo: true,
    ...overrides,
  });

const montar = () => {
  const app = express();
  app.use(express.json());
  app.post('/forgot-password', forgotPassword);
  app.post('/reset-password', resetPassword);
  return app;
};

describe('PasswordResetController', () => {
  let app;
  const transportOriginal = config.mail.transport;

  beforeEach(async () => {
    await cleanDb();
    app = montar();
    // Sin SMTP el controller no filtra nada y responde igual: los tests no
    // dependen de que haya un servidor de correo levantado.
    config.mail.transport = '';
  });

  afterAll(() => {
    config.mail.transport = transportOriginal;
  });

  describe('POST /forgot-password', () => {
    test('responde 200 con el mensaje genérico para un email existente', async () => {
      await crearUsuario();
      const res = await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe(MENSAJE_SOLICITUD);
    });

    test('responde EXACTAMENTE lo mismo para un email inexistente', async () => {
      await crearUsuario();

      const existente = await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });
      const inexistente = await request(app)
        .post('/forgot-password')
        .send({ email: 'nadie@test.com' });

      expect(inexistente.status).toBe(existente.status);
      expect(inexistente.body).toEqual(existente.body);
    });

    test('no crea token para un email inexistente', async () => {
      await request(app)
        .post('/forgot-password')
        .send({ email: 'nadie@test.com' });
      const tokens = await db.PasswordResetToken.count();
      expect(tokens).toBe(0);
    });

    test('normaliza el email (trim + lowercase) para encontrar la cuenta', async () => {
      const usuario = await crearUsuario();
      await request(app)
        .post('/forgot-password')
        .send({ email: '  CLIENTE@Test.COM  ' });

      const tokens = await db.PasswordResetToken.findAll({
        where: { usuarioId: usuario.id },
      });
      expect(tokens).toHaveLength(1);
    });

    test('no emite token para usuarios inactivos', async () => {
      await crearUsuario({ activo: false });
      const res = await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });

      expect(res.body.data.message).toBe(MENSAJE_SOLICITUD);
      expect(await db.PasswordResetToken.count()).toBe(0);
    });

    test('un email mal formado responde igual y no consulta', async () => {
      const res = await request(app)
        .post('/forgot-password')
        .send({ email: 'no-es-email' });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe(MENSAJE_SOLICITUD);
    });

    test('un body vacío no rompe el endpoint', async () => {
      const res = await request(app).post('/forgot-password').send({});
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe(MENSAJE_SOLICITUD);
    });

    test('nunca escribe el token en los logs', async () => {
      await crearUsuario();
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });

      const registro = await db.PasswordResetToken.findOne();
      const impreso = spy.mock.calls.flat().join(' ');
      // Solo puede aparecer el hash, nunca un token de 64 hex en claro que
      // difiera del hash persistido.
      expect(impreso).not.toMatch(/[a-f0-9]{64}/);
      expect(registro.tokenHash).toBeTruthy();
    });

    test('una segunda solicitud invalida el token anterior', async () => {
      const usuario = await crearUsuario();
      await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });
      await request(app)
        .post('/forgot-password')
        .send({ email: 'cliente@test.com' });

      const tokens = await db.PasswordResetToken.findAll({
        where: { usuarioId: usuario.id },
      });
      expect(tokens).toHaveLength(2);
      expect(tokens.filter((t) => t.invalidatedAt === null)).toHaveLength(1);
    });
  });

  describe('POST /reset-password', () => {
    const emitir = async (usuario) => {
      const token = generarToken();
      await db.PasswordResetToken.create({
        usuarioId: usuario.id,
        tokenHash: hashearToken(token),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      return token;
    };

    test('cambia la contraseña con un token válido', async () => {
      const usuario = await crearUsuario();
      const token = await emitir(usuario);

      const res = await request(app).post('/reset-password').send({
        token,
        password: 'nuevaClave123',
        confirmPassword: 'nuevaClave123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const recargado = await db.Usuario.findByPk(usuario.id);
      expect(await recargado.verificarPassword('nuevaClave123')).toBe(true);
    });

    test('rechaza contraseñas que no coinciden sin tocar el token', async () => {
      const usuario = await crearUsuario();
      const token = await emitir(usuario);

      const res = await request(app).post('/reset-password').send({
        token,
        password: 'nuevaClave123',
        confirmPassword: 'otraClave123',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // El token NO se gasta: el usuario puede reintentar con la contraseña correcta.
      const registro = await db.PasswordResetToken.findOne();
      expect(registro.usedAt).toBeNull();
    });

    test('rechaza contraseñas de menos de 6 caracteres', async () => {
      const usuario = await crearUsuario();
      const token = await emitir(usuario);

      const res = await request(app).post('/reset-password').send({
        token,
        password: 'corta',
        confirmPassword: 'corta',
      });

      expect(res.status).toBe(400);
      expect(await db.PasswordResetToken.count()).toBeGreaterThan(0);
    });

    test('todos los tokens inválidos devuelven el MISMO mensaje', async () => {
      const usuario = await crearUsuario();

      const casos = [];

      // Inexistente
      casos.push(
        await request(app).post('/reset-password').send({
          token: generarToken(),
          password: 'nuevaClave123',
          confirmPassword: 'nuevaClave123',
        })
      );

      // Mal formado
      casos.push(
        await request(app).post('/reset-password').send({
          token: 'basura',
          password: 'nuevaClave123',
          confirmPassword: 'nuevaClave123',
        })
      );

      // Expirado
      const expirado = generarToken();
      await db.PasswordResetToken.create({
        usuarioId: usuario.id,
        tokenHash: hashearToken(expirado),
        expiresAt: new Date(Date.now() - 1000),
      });
      casos.push(
        await request(app).post('/reset-password').send({
          token: expirado,
          password: 'nuevaClave123',
          confirmPassword: 'nuevaClave123',
        })
      );

      // Usado
      const usado = generarToken();
      await db.PasswordResetToken.create({
        usuarioId: usuario.id,
        tokenHash: hashearToken(usado),
        expiresAt: new Date(Date.now() + 600000),
        usedAt: new Date(),
      });
      casos.push(
        await request(app).post('/reset-password').send({
          token: usado,
          password: 'nuevaClave123',
          confirmPassword: 'nuevaClave123',
        })
      );

      // Invalidado
      const invalidado = generarToken();
      const previo = generarToken();
      await db.PasswordResetToken.create({
        usuarioId: usuario.id,
        tokenHash: hashearToken(previo),
        expiresAt: new Date(Date.now() + 600000),
      });
      await emitir(usuario); // invalida el anterior
      await db.PasswordResetToken.create({
        usuarioId: usuario.id,
        tokenHash: hashearToken(invalidado),
        expiresAt: new Date(Date.now() - 1000),
        invalidatedAt: new Date(),
      });
      casos.push(
        await request(app).post('/reset-password').send({
          token: invalidado,
          password: 'nuevaClave123',
          confirmPassword: 'nuevaClave123',
        })
      );

      casos.forEach((res) => {
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe(MENSAJE_TOKEN_GENERICO);
      });
    });

    test('un token usado no puede reutilizarse (mensaje genérico)', async () => {
      const usuario = await crearUsuario();
      const token = await emitir(usuario);

      const primero = await request(app).post('/reset-password').send({
        token,
        password: 'primeraClave1',
        confirmPassword: 'primeraClave1',
      });
      const segundo = await request(app).post('/reset-password').send({
        token,
        password: 'segundaClave2',
        confirmPassword: 'segundaClave2',
      });

      expect(primero.status).toBe(200);
      expect(segundo.status).toBe(400);
      expect(segundo.body.error).toBe(MENSAJE_TOKEN_GENERICO);

      const recargado = await db.Usuario.findByPk(usuario.id);
      expect(await recargado.verificarPassword('primeraClave1')).toBe(true);
    });

    test('no filtra el token rechazado en la respuesta', async () => {
      const usuario = await crearUsuario();
      const token = await emitir(usuario);
      await db.PasswordResetToken.update(
        { usedAt: new Date() },
        { where: { tokenHash: hashearToken(token) } }
      );

      const res = await request(app).post('/reset-password').send({
        token,
        password: 'nuevaClave123',
        confirmPassword: 'nuevaClave123',
      });

      expect(JSON.stringify(res.body)).not.toContain(token);
    });

    test('un body vacío no rompe el endpoint', async () => {
      const res = await request(app).post('/reset-password').send({});
      expect(res.status).toBe(400);
    });
  });
});
