import express from 'express';
import request from 'supertest';
import {
  passwordResetIpLimiter,
  passwordResetEmailLimiter,
} from './rate_limit';
import config from '../config/config';

const mensaje429 =
  'Demasiadas solicitudes de recuperación. Intente nuevamente más tarde.';

const montar = (middlewares) => {
  const app = express();
  app.use(express.json());
  app.post('/forgot', ...middlewares, (req, res) =>
    res.json({ success: true, data: { message: 'ok' } })
  );
  return app;
};

describe('Rate limit de recuperación de contraseña', () => {
  const ipOriginal = config.rateLimit.enabled;

  beforeEach(() => {
    config.rateLimit.enabled = true;
  });

  afterAll(() => {
    config.rateLimit.enabled = ipOriginal;
  });

  describe('por IP', () => {
    test('bloquea al superar el máximo configurado', async () => {
      const app = montar([passwordResetIpLimiter]);
      const max = config.passwordReset.rateLimitIp.max;
      const cantidad = Math.min(max + 2, max);

      let ultimo;
      for (let i = 0; i < cantidad; i += 1) {
        // Cada request usa un email distinto para no chocar con el límite de email.
        ultimo = await request(app)
          .post('/forgot')
          .send({ email: `alguien${i}@test.com` });
      }

      // Las primeras `max` pasan; la siguiente devuelve 429.
      const excedida = await request(app)
        .post('/forgot')
        .send({ email: 'ultimo@test.com' });

      expect(ultimo.status).toBe(200);
      expect(excedida.status).toBe(429);
      expect(excedida.body.error).toBe(mensaje429);
    });

    test('el mensaje 429 no revela si el límite fue por IP o por email', async () => {
      const app = montar([passwordResetEmailLimiter]);
      const max = config.passwordReset.rateLimitEmail.max;

      for (let i = 0; i < max; i += 1) {
        await request(app).post('/forgot').send({ email: 'mismo@test.com' });
      }
      const bloqueada = await request(app)
        .post('/forgot')
        .send({ email: 'mismo@test.com' });

      expect(bloqueada.status).toBe(429);
      expect(bloqueada.body.error).toBe(mensaje429);
      expect(bloqueada.body.error).not.toMatch(/ip|email|correo/i);
    });
  });

  describe('por email normalizado', () => {
    test('el mismo email con distinta capitalización cuenta como uno solo', async () => {
      const app = montar([passwordResetEmailLimiter]);
      const max = config.passwordReset.rateLimitEmail.max;

      for (let i = 0; i < max; i += 1) {
        await request(app).post('/forgot').send({ email: 'Mismo@Test.COM ' });
      }

      const bloqueada = await request(app)
        .post('/forgot')
        .send({ email: 'mismo@test.com' });

      expect(bloqueada.status).toBe(429);
    });

    test('emails distintos no comparten el límite', async () => {
      const app = montar([passwordResetEmailLimiter]);
      const max = config.passwordReset.rateLimitEmail.max;

      for (let i = 0; i < max + 2; i += 1) {
        const r = await request(app)
          .post('/forgot')
          .send({ email: `distinto${i}@test.com` });
        expect(r.status).toBe(200);
      }
    });

    test('una solicitud sin email no rompe el keyGenerator', async () => {
      const app = montar([passwordResetEmailLimiter]);
      const r = await request(app).post('/forgot').send({});
      expect(r.status).toBe(200);
    });
  });

  describe('desactivación por configuración', () => {
    test('con RATE_LIMIT_ENABLED=false no bloquea', async () => {
      config.rateLimit.enabled = false;
      const app = montar([passwordResetIpLimiter, passwordResetEmailLimiter]);
      const max = config.passwordReset.rateLimitIp.max;

      for (let i = 0; i < max + 5; i += 1) {
        const r = await request(app)
          .post('/forgot')
          .send({ email: 'libre@test.com' });
        expect(r.status).toBe(200);
      }
    });
  });

  describe('valores por defecto', () => {
    test('3 solicitudes por hora en ambos límites', () => {
      expect(config.passwordReset.rateLimitIp.max).toBe(3);
      expect(config.passwordReset.rateLimitIp.windowMinutes).toBe(60);
      expect(config.passwordReset.rateLimitEmail.max).toBe(3);
      expect(config.passwordReset.rateLimitEmail.windowMinutes).toBe(60);
    });
  });
});
