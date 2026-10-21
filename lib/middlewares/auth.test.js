import express from 'express';
import request from 'supertest';
import {
  acotarASucursalPropia,
  requiereSucursal,
  requiereSucursalOperativa,
  sucursalDeSesion,
  sucursalOperativaDeSesion,
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

const montarAcotado = (usuario, session = {}) => {
  const app = express();
  app.get(
    '/stock/:sucursalId',
    (req, res, next) => {
      req.usuario = usuario;
      req.session = { ...session };
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

  test('no acota al SUPERADMINISTRADOR sin contexto (la ruta lo exige antes)', async () => {
    const res = await request(
      montarAcotado({ rol: 'SUPERADMINISTRADOR', sucursalId: null })
    ).get('/stock/9');

    expect(res.status).toBe(200);
  });

  test('acota al SUPERADMINISTRADOR a la sucursal de su contexto', async () => {
    const propia = await request(
      montarAcotado({ rol: 'SUPERADMINISTRADOR' }, { sucursalOperativaId: 5 })
    ).get('/stock/5');
    expect(propia.status).toBe(200);

    const ajena = await request(
      montarAcotado({ rol: 'SUPERADMINISTRADOR' }, { sucursalOperativaId: 5 })
    ).get('/stock/9');
    expect(ajena.status).toBe(403);
    expect(ajena.body.success).toBe(false);
  });
});

describe('sucursalOperativaDeSesion', () => {
  test('ADMINISTRADOR → su sucursal asignada', () => {
    expect(
      sucursalOperativaDeSesion({
        usuario: { rol: 'ADMINISTRADOR', sucursalId: 5 },
      })
    ).toBe(5);
  });

  test('SUPERADMINISTRADOR → el contexto elegido en la sesión', () => {
    expect(
      sucursalOperativaDeSesion({
        usuario: { rol: 'SUPERADMINISTRADOR' },
        session: { sucursalOperativaId: 7 },
      })
    ).toBe(7);
  });

  test('SUPERADMINISTRADOR sin contexto (o con id inválido) → null', () => {
    expect(
      sucursalOperativaDeSesion({
        usuario: { rol: 'SUPERADMINISTRADOR' },
        session: {},
      })
    ).toBeNull();
    expect(
      sucursalOperativaDeSesion({
        usuario: { rol: 'SUPERADMINISTRADOR' },
        session: { sucursalOperativaId: 'abc' },
      })
    ).toBeNull();
  });

  test('CLIENTE y sin usuario → null', () => {
    expect(
      sucursalOperativaDeSesion({ usuario: { rol: 'CLIENTE' } })
    ).toBeNull();
    expect(sucursalOperativaDeSesion({})).toBeNull();
  });
});

const montarOperativo = (usuario, session = {}) => {
  const app = express();
  app.get(
    '/operativo',
    (req, res, next) => {
      req.usuario = usuario;
      req.session = { ...session };
      next();
    },
    requiereSucursalOperativa,
    (req, res) =>
      res.json({
        success: true,
        data: { sucursalId: sucursalOperativaDeSesion(req) },
      })
  );
  return app;
};

describe('requiereSucursalOperativa', () => {
  test('deja pasar al ADMINISTRADOR con sucursal asignada', async () => {
    const res = await request(
      montarOperativo({ rol: 'ADMINISTRADOR', sucursalId: 5 })
    ).get('/operativo');

    expect(res.status).toBe(200);
    expect(res.body.data.sucursalId).toBe(5);
  });

  test('bloquea (403) al ADMINISTRADOR sin sucursal', async () => {
    const res = await request(
      montarOperativo({ rol: 'ADMINISTRADOR', sucursalId: null })
    ).get('/operativo');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/sucursal asignada/i);
  });

  test('deja pasar al SUPERADMINISTRADOR con contexto elegido', async () => {
    const res = await request(
      montarOperativo({ rol: 'SUPERADMINISTRADOR' }, { sucursalOperativaId: 7 })
    ).get('/operativo');

    expect(res.status).toBe(200);
    expect(res.body.data.sucursalId).toBe(7);
  });

  test('bloquea (403) al SUPERADMINISTRADOR sin contexto, con mensaje de elección', async () => {
    const res = await request(
      montarOperativo({ rol: 'SUPERADMINISTRADOR' })
    ).get('/operativo');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Elegí una sucursal/i);
  });

  test('deja pasar al CLIENTE (su autorización es por propiedad, no sucursal)', async () => {
    const res = await request(montarOperativo({ rol: 'CLIENTE' })).get(
      '/operativo'
    );

    expect(res.status).toBe(200);
  });
});
