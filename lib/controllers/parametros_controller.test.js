import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import { CLAVES } from '../services/parametros_service';

const agenteAnon = request.agent(app);
const agenteCliente = request.agent(app);
const agenteAdmin = request.agent(app);
const agenteSuper = request.agent(app);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function registrarYLoguear(agente, email, rol) {
  await crearUsuario({ email, rol });
  const csrf = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: '123456' });
}

async function putSuper(agente, body) {
  const csrf = await obtenerCsrf(agente);
  return agente
    .put('/api/superadmin/parametros')
    .set('x-csrf-token', csrf)
    .send(body);
}

describe('Parametros controller', () => {
  beforeAll(async () => {
    await cleanDb();
    await registrarYLoguear(
      agenteCliente,
      'cliente-parametros@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-parametros@test.com',
      'ADMINISTRADOR'
    );
    await registrarYLoguear(
      agenteSuper,
      'super-parametros@test.com',
      'SUPERADMINISTRADOR'
    );
  });

  describe('GET /api/parametros', () => {
    it('es publico y devuelve el catalogo completo', async () => {
      const res = await agenteAnon.get('/api/parametros');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(CLAVES.length);
      const claves = res.body.data.map((p) => p.clave);
      expect(claves).toEqual(expect.arrayContaining(CLAVES));
    });

    it('expone el valor por defecto cuando la clave no tiene fila', async () => {
      const res = await agenteAnon.get('/api/parametros');
      const radio = res.body.data.find((p) => p.clave === 'radioCoberturaKm');
      expect(radio.valor).toBe(5);
      expect(radio.valorPorDefecto).toBe(5);
      expect(radio.grupo).toBe('cobertura');
    });
  });

  describe('PUT /api/superadmin/parametros', () => {
    it('rechaza sin sesion (401/403)', async () => {
      const res = await request(app)
        .put('/api/superadmin/parametros')
        .send({ costoEnvioFijo: 500 });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('rechaza a un CLIENTE (403)', async () => {
      const res = await putSuper(agenteCliente, { costoEnvioFijo: 500 });
      expect(res.statusCode).toBe(403);
    });

    it('rechaza a un ADMINISTRADOR (403)', async () => {
      const res = await putSuper(agenteAdmin, { costoEnvioFijo: 500 });
      expect(res.statusCode).toBe(403);
    });

    it('el SUPERADMIN actualiza y persiste el valor', async () => {
      const res = await putSuper(agenteSuper, { costoEnvioFijo: 750 });
      expect(res.statusCode).toBe(200);
      const costo = res.body.data.find((p) => p.clave === 'costoEnvioFijo');
      expect(costo.valor).toBe(750);

      const publico = await agenteAnon.get('/api/parametros');
      const costoPublico = publico.body.data.find(
        (p) => p.clave === 'costoEnvioFijo'
      );
      expect(costoPublico.valor).toBe(750);
    });

    it('valida el lote completo: no escribe si una clave es desconocida (400)', async () => {
      const res = await putSuper(agenteSuper, {
        costoEnvioFijo: 900,
        claveInexistente: 1,
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      const publico = await agenteAnon.get('/api/parametros');
      const costo = publico.body.data.find((p) => p.clave === 'costoEnvioFijo');
      // No se guardo el 900: el lote entero se rechazo.
      expect(costo.valor).toBe(750);
    });

    it('rechaza un valor fuera de rango (400)', async () => {
      const res = await putSuper(agenteSuper, {
        porcentajeMaximoDescuento: 150,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza un valor de tipo incorrecto (400)', async () => {
      const res = await putSuper(agenteSuper, {
        cantidadMaximaItemsPedido: 3.5,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza un body que no sea un objeto de parametros (400)', async () => {
      const res = await putSuper(agenteSuper, {});
      expect(res.statusCode).toBe(400);
    });
  });
});
