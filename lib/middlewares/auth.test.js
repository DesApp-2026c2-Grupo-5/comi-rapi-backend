import express from 'express';
import request from 'supertest';
import {
  acotarASucursalPropia,
  requiereSucursal,
  sucursalDeSesion,
} from './auth';

const montar = (usuario) => {
  const app = express();
  app.get(
    '/acotado',
    (req, res, next) => {
      req.usuario = usuario;
      next();
    },
    requiereSucursal,
    (req, res) =>
      res.json({ success: true, data: { sucursalId: sucursalDeSesion(req) } })
  );
  return app;
};

describe('sucursalDeSesion', () => {
  test('extrae el sucursalId del usuario de la sesión', () => {
    expect(sucursalDeSesion({ usuario: { sucursalId: 3 } })).toBe(3);
  });

  test('es null sin usuario o sin sucursal asignada', () => {
    expect(sucursalDeSesion({})).toBeNull();
    expect(sucursalDeSesion({ usuario: { rol: 'CLIENTE' } })).toBeNull();
  });
});

describe('requiereSucursal', () => {
  test('deja pasar a un ADMINISTRADOR con sucursal', async () => {
    const res = await request(
      montar({ rol: 'ADMINISTRADOR', sucursalId: 5 })
    ).get('/acotado');

    expect(res.status).toBe(200);
    expect(res.body.data.sucursalId).toBe(5);
  });

  test('bloquea (403) a un ADMINISTRADOR sin sucursal', async () => {
    const res = await request(
      montar({ rol: 'ADMINISTRADOR', sucursalId: null })
    ).get('/acotado');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('no acota al SUPERADMINISTRADOR (pasa sin sucursal)', async () => {
    const res = await request(
      montar({ rol: 'SUPERADMINISTRADOR', sucursalId: null })
    ).get('/acotado');

    expect(res.status).toBe(200);
  });

  test('no acota al CLIENTE', async () => {
    const res = await request(montar({ rol: 'CLIENTE', sucursalId: null })).get(
      '/acotado'
    );

    expect(res.status).toBe(200);
  });
});

const montarAcotado = (usuario) => {
  const app = express();
  app.get(
    '/stock/:sucursalId',
    (req, res, next) => {
      req.usuario = usuario;
      next();
    },
    acotarASucursalPropia,
    (req, res) => res.json({ success: true })
  );
  return app;
};

describe('acotarASucursalPropia', () => {
  test('deja pasar al admin hacia su propia sucursal', async () => {
    const res = await request(
      montarAcotado({ rol: 'ADMINISTRADOR', sucursalId: 5 })
    ).get('/stock/5');

    expect(res.status).toBe(200);
  });

  test('bloquea (403) al admin hacia otra sucursal', async () => {
    const res = await request(
      montarAcotado({ rol: 'ADMINISTRADOR', sucursalId: 5 })
    ).get('/stock/9');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('no acota al SUPERADMINISTRADOR', async () => {
    const res = await request(
      montarAcotado({ rol: 'SUPERADMINISTRADOR', sucursalId: null })
    ).get('/stock/9');

    expect(res.status).toBe(200);
  });
});
