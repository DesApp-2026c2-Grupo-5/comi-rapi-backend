import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

/**
 * La comunicación HTTP (Georef y ORS) se mockea: los tests NO dependen de APIs
 * externas. Solo los tests de create/update la necesitan (validación → 400 y
 * GET/DELETE no llaman a proveedores).
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

const { Direccion, Sucursal } = db;

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);
const agenteSuper = request.agent(app);

let clienteId;
let otroClienteId;

function respuestaGeorefOk(provincia, departamento) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 1,
      direcciones: [
        {
          nomenclatura: `DIRECCION 1, ${departamento}, ${provincia}`,
          ubicacion: { lat: -34.60385632930893, lon: -58.38419018127011 },
          calle: { nombre: 'DIRECCION' },
          provincia: { nombre: provincia },
          departamento: { nombre: departamento },
          localidad_censal: { nombre: departamento },
        },
      ],
    }),
    text: async () => '',
  };
}

function respuestaGeorefVacia() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ total: 0, direcciones: [] }),
    text: async () => '',
  };
}

// Iteración 1-geo: la ambigüedad se define por identidad territorial
// (provincia + departamento + localidad censal + calle): dos resultados con
// la misma identidad son el mismo lugar (segmentos) y no son ambiguos. Con
// el partido obligatorio en Buenos Aires, el caso real de ambigüedad es CABA
// (mismo nombre de calle en distintas comunas, sin comuna ingresada).
function respuestaGeorefAmbigua() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 2,
      direcciones: [
        {
          nomenclatura:
            'CALLE FALSA 123, Comuna 1, Ciudad Autónoma de Buenos Aires',
          ubicacion: { lat: -34.6, lon: -58.38 },
          calle: { nombre: 'CALLE FALSA' },
          provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
          departamento: { nombre: 'Comuna 1' },
          localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' },
        },
        {
          nomenclatura:
            'CALLE FALSA 123, Comuna 13, Ciudad Autónoma de Buenos Aires',
          ubicacion: { lat: -34.61, lon: -58.39 },
          calle: { nombre: 'CALLE FALSA' },
          provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
          departamento: { nombre: 'Comuna 13' },
          localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' },
        },
      ],
    }),
    text: async () => '',
  };
}

// Iteración 1-geo: varios segmentos de la misma calle en la misma comuna
// (misma identidad territorial, coords a ~240 m): NO es ambigua; se toma el
// primer resultado (verificado en vivo contra Georef).
function respuestaGeorefSegmentos() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 2,
      direcciones: [
        {
          nomenclatura:
            'CALLE FALSA 123, Comuna 13, Ciudad Autónoma de Buenos Aires',
          ubicacion: { lat: -34.6123, lon: -58.3718 },
          calle: { nombre: 'CALLE FALSA' },
          provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
          departamento: { nombre: 'Comuna 13' },
          localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' },
        },
        {
          nomenclatura:
            'CALLE FALSA 123, Comuna 13, Ciudad Autónoma de Buenos Aires',
          ubicacion: { lat: -34.6124, lon: -58.3719 },
          calle: { nombre: 'CALLE FALSA' },
          provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
          departamento: { nombre: 'Comuna 13' },
          localidad_censal: { nombre: 'Ciudad Autónoma de Buenos Aires' },
        },
      ],
    }),
    text: async () => '',
  };
}

function respuestaOrs(distanciaMetros) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { summary: { distance: distanciaMetros, duration: 600 } },
          geometry: { type: 'LineString', coordinates: [[-58.38, -34.6]] },
        },
      ],
      metadata: { query: {}, engine: {} },
    }),
    text: async () => '',
  };
}

/**
 * Configura el mock de fetch: llamadas a Georef devuelven `georef`; llamadas a
 * ORS devuelven las distancias de `rutas` en orden (una por sucursal activa
 * geolocalizada).
 */
function configurarMock({ georef, rutas = [] }) {
  let indice = 0;
  fetch.mockImplementation(async (url) => {
    if (String(url).includes('georef')) {
      return georef;
    }
    const distancia = rutas[indice];
    indice += 1;
    return respuestaOrs(distancia);
  });
}

async function crearSucursalGeolocalizada({ latitud, longitud }) {
  const sucursal = await Sucursal.create({
    nombre: `Sucursal ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    activa: true,
  });
  await Direccion.create({
    sucursalId: sucursal.id,
    calle: 'Av. Sucursal',
    altura: 1,
    provincia: 'Ciudad Autónoma de Buenos Aires',
    localidad: 'CABA',
    codigoPostal: '1000',
    latitud,
    longitud,
    activa: true,
  });
  return sucursal;
}

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

describe('Direcciones controller', () => {
  beforeAll(async () => {
    await cleanDb();
    clienteId = await registrarYLoguear(
      agenteCliente,
      'cliente-direcciones@test.com',
      'CLIENTE'
    );
    otroClienteId = await registrarYLoguear(
      agenteOtro,
      'otro-direcciones@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-direcciones@test.com',
      'ADMINISTRADOR'
    );
    await registrarYLoguear(
      agenteSuper,
      'super-direcciones@test.com',
      'SUPERADMINISTRADOR'
    );
  });

  beforeEach(async () => {
    fetch.mockClear();
    await Direccion.destroy({ where: {}, force: true });
    await Direccion.create({
      usuarioId: clienteId,
      calle: 'Av. Siempreviva',
      altura: 1234,
      provincia: 'Buenos Aires',
      departamento: 'Tres de Febrero',
      localidad: 'CABA',
      codigoPostal: '1406',
      referencia: 'Casa verde',
      alias: 'Casa',
      activa: true,
    });
    // Sucursal activa geolocalizada para la validación de cobertura (create).
    await crearSucursalGeolocalizada({
      latitud: -34.6037,
      longitud: -58.3816,
    });
  });

  describe('GET /api/direcciones', () => {
    it('devuelve solo las direcciones activas del cliente autenticado', async () => {
      const res = await agenteCliente.get('/api/direcciones');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].calle).toBe('Av. Siempreviva');
      expect(res.body.data[0].latitud).toBeNull();
    });

    it('no filtra direcciones de otros clientes (aislamiento por usuario)', async () => {
      await Direccion.create({
        usuarioId: otroClienteId,
        calle: 'Calle Ajena',
        altura: 1,
        provincia: 'Buenos Aires',
        localidad: 'CABA',
        codigoPostal: '1406',
        activa: true,
      });
      const res = await agenteCliente.get('/api/direcciones');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data.every((d) => d.usuarioId === clienteId)).toBe(true);
    });

    it('responde 401 sin sesión', async () => {
      const res = await request(app).get('/api/direcciones');
      expect(res.statusCode).toBe(401);
    });

    it('sin flag no incluye cobertura (compatibilidad)', async () => {
      const res = await agenteAdmin.get(
        `/api/direcciones?usuarioId=${clienteId}`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).not.toHaveProperty('cobertura');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('SUPERADMINISTRADOR ve direcciones del cliente', async () => {
      const res = await agenteSuper.get(
        `/api/direcciones?usuarioId=${clienteId}&cobertura=true`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].usuarioId).toBe(clienteId);
    });
  });

  describe('GET /api/direcciones?cobertura=true', () => {
    async function crearDireccionConCoords() {
      return Direccion.create({
        usuarioId: clienteId,
        calle: 'Av. Corrientes',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
        departamento: 'Comuna 1',
        localidad: 'CABA',
        codigoPostal: '1000',
        latitud: -34.6038,
        longitud: -58.3842,
        activa: true,
      });
    }

    it('adjunta la sucursal más cercana dentro del radio', async () => {
      await crearDireccionConCoords();
      fetch.mockImplementation(async () => respuestaOrs(2000));

      const res = await agenteAdmin.get(
        `/api/direcciones?usuarioId=${clienteId}&cobertura=true`
      );
      expect(res.statusCode).toBe(200);
      const conCoords = res.body.data.find((d) => d.calle === 'Av. Corrientes');
      expect(conCoords.cobertura.disponible).toBe(true);
      expect(conCoords.cobertura.sucursal.distanciaMetros).toBe(2000);
      expect(typeof conCoords.cobertura.sucursal.nombre).toBe('string');
    });

    it('sin coordenadas informa sin cobertura sin llamar a ORS', async () => {
      fetch.mockImplementation(async () => respuestaOrs(2000));

      const res = await agenteAdmin.get(
        `/api/direcciones?usuarioId=${clienteId}&cobertura=true`
      );
      expect(res.statusCode).toBe(200);
      // La de beforeEach no tiene latitud/longitud.
      const sinCoords = res.body.data.find(
        (d) => d.calle === 'Av. Siempreviva'
      );
      expect(sinCoords.cobertura).toEqual({
        disponible: false,
        sucursal: null,
      });
    });

    it('si ORS falla responde igual con disponible false', async () => {
      await crearDireccionConCoords();
      fetch.mockRejectedValue(new Error('ors caído'));

      const res = await agenteAdmin.get(
        `/api/direcciones?usuarioId=${clienteId}&cobertura=true`
      );
      expect(res.statusCode).toBe(200);
      const conCoords = res.body.data.find((d) => d.calle === 'Av. Corrientes');
      expect(conCoords.cobertura).toEqual({
        disponible: false,
        sucursal: null,
      });
    });
  });

  describe('POST /api/direcciones', () => {
    it('crea una dirección geocodificada: persiste latitud/longitud del backend', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [2000],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Corrientes',
          altura: 1234,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1043',
          alias: 'Trabajo',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      // Iteración 2: la calle se persiste normalizada por Georef (el mock
      // devuelve nombre oficial 'DIRECCION'), no con el texto del usuario.
      expect(res.body.data.calle).toBe('DIRECCION');
      expect(res.body.data.altura).toBe(1234);
      expect(res.body.data.provincia).toBe('Ciudad Autónoma de Buenos Aires');
      // Iteración 1-geo: localidad/partido normalizados por Georef (no el
      // texto crudo 'CABA') y nomenclatura persistida.
      expect(res.body.data.departamento).toBe('Comuna 1');
      expect(res.body.data.localidad).toBe('Comuna 1');
      expect(res.body.data.nomenclatura).toBe(
        'DIRECCION 1, Comuna 1, Ciudad Autónoma de Buenos Aires'
      );
      expect(res.body.data.codigoPostal).toBe('1043');
      expect(res.body.data.latitud).toBeCloseTo(-34.60385632930893);
      expect(res.body.data.longitud).toBeCloseTo(-58.38419018127011);
      expect(res.body.data.usuarioId).toBe(clienteId);
      // 1 llamada a Georef + 1 a ORS (sucursal activa geolocalizada).
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('dirección no encontrada en Georef → 422 sin persistir', async () => {
      configurarMock({ georef: respuestaGeorefVacia(), rutas: [] });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Inexistente',
          altura: 99999,
          provincia: 'Buenos Aires',
          departamento: 'Quilmes',
          localidad: 'CABA',
          codigoPostal: '1406',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/no pudo ser ubicada/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    // Iteración 1-geo: la ambigüedad ya no es un rechazo seco (422): el
    // backend devuelve 409 con las identidades territoriales para que el
    // usuario elija una y reintente. Caso real: CABA sin comuna ingresada,
    // mismo nombre de calle en dos comunas.
    it('dirección con varias identidades territoriales → 409 con opciones, sin persistir', async () => {
      configurarMock({ georef: respuestaGeorefAmbigua(), rutas: [] });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Falsa',
          altura: 123,
          provincia: 'Ciudad Autónoma de Buenos Aires',
        });
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/varias ubicaciones/i);
      expect(res.body.opciones).toHaveLength(2);
      expect(res.body.opciones.map((o) => o.departamento)).toEqual([
        'Comuna 1',
        'Comuna 13',
      ]);
      expect(res.body.opciones[0].nomenclatura).toBe(
        'CALLE FALSA 123, Comuna 1, Ciudad Autónoma de Buenos Aires'
      );
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('reintento con la comuna elegida resuelve la ambigüedad → 201', async () => {
      // Primera llamada: ambigua (2 comunas). Reintento con la comuna elegida
      // por el usuario: 2 segmentos de la misma calle en la misma comuna
      // (misma identidad territorial) → NO ambigua → 201.
      fetch.mockImplementation(async (url) => {
        // URLSearchParams codifica el espacio como '+': "Comuna 13" → "Comuna+13".
        if (String(url).includes('departamento=Comuna+13')) {
          return respuestaGeorefSegmentos();
        }
        if (String(url).includes('georef')) {
          return respuestaGeorefAmbigua();
        }
        return respuestaOrs(2000);
      });
      const csrf = await obtenerCsrf(agenteCliente);

      const primero = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Falsa',
          altura: 123,
          provincia: 'Ciudad Autónoma de Buenos Aires',
        });
      expect(primero.statusCode).toBe(409);
      expect(primero.body.opciones).toHaveLength(2);

      const reintento = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Falsa',
          altura: 123,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          departamento: 'Comuna 13',
        });
      expect(reintento.statusCode).toBe(201);
      expect(reintento.body.data.departamento).toBe('Comuna 13');
      expect(reintento.body.data.nomenclatura).toBe(
        'CALLE FALSA 123, Comuna 13, Ciudad Autónoma de Buenos Aires'
      );
      expect(reintento.body.data.latitud).toBeCloseTo(-34.6123);
      // Persistió una dirección nueva con la identidad elegida.
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        2
      );
    });

    it('dirección fuera de la zona de operación → 422 sin persistir', async () => {
      configurarMock({
        georef: respuestaGeorefOk('Córdoba', 'Capital'),
        rutas: [],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Colón',
          altura: 100,
          provincia: 'Córdoba',
          localidad: 'Córdoba',
          codigoPostal: '5000',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/fuera de la zona/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('sin sucursales dentro de la cobertura → 422 sin persistir', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [9000],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Lejana',
          altura: 2000,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1406',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/cobertura/i);
      // Iteración 5: el 422 expone la distancia de la sucursal activa más
      // cercana como detalle funcional (antes se perdía en el error handler).
      expect(res.body.detalle).toEqual({ distanciaMasCercanaMetros: 9000 });
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('rechaza sin calle (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          altura: 100,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin altura (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin provincia (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    // Iteración 1-geo: la localidad es opcional en el ingreso; la regla
    // territorial nueva es el partido obligatorio en Buenos Aires.
    it('dirección de Buenos Aires sin partido → 400 (regla territorial)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          provincia: 'Buenos Aires',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/partido es obligatorio/i);
    });

    // Iteración 1-geo: localidad y código postal opcionales (el backend
    // determina la localidad y Georef no provee el CP).
    it('dirección sin localidad ni codigoPostal (CABA): 201 con null', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 3'
        ),
        rutas: [1500],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Corrientes',
          altura: 1234,
          provincia: 'Ciudad Autónoma de Buenos Aires',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.codigoPostal).toBeNull();
      expect(res.body.data.localidad).toBe('Comuna 3');
      expect(res.body.data.departamento).toBe('Comuna 3');
      expect(res.body.data.nomenclatura).toBe(
        'DIRECCION 1, Comuna 3, Ciudad Autónoma de Buenos Aires'
      );
    });

    it('acumula todos los errores de validación en un único mensaje (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          altura: -5,
          provincia: '',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('La calle es obligatoria');
      expect(res.body.error).toContain('La altura debe ser');
      expect(res.body.error).toContain('La provincia');
    });

    it('rechaza latitud/longitud ingresadas manualmente (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
          latitud: -34.6,
          longitud: -58.38,
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no se ingresan manualmente/);
    });

    it('rechaza a un ADMINISTRADOR (403)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'X',
          altura: 1,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PUT /api/direcciones/:id', () => {
    it('actualiza campos parciales de una dirección propia', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ alias: 'Nuevo alias', referencia: 'Nueva referencia' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.alias).toBe('Nuevo alias');
      expect(res.body.data.referencia).toBe('Nueva referencia');
      // Cambios sin campos de ubicación: sin llamadas a proveedores.
      expect(fetch).not.toHaveBeenCalled();
    });

    it('cambio de ubicación: re-geocodifica y actualiza coordenadas', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [3000],
      });
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Av. Nueva', altura: 999 });
      expect(res.statusCode).toBe(200);
      // Iteración 2: calle normalizada por Georef (nombre oficial del mock).
      expect(res.body.data.calle).toBe('DIRECCION');
      expect(res.body.data.altura).toBe(999);
      expect(res.body.data.latitud).toBeCloseTo(-34.60385632930893);
      expect(res.body.data.longitud).toBeCloseTo(-58.38419018127011);
      // 1 Georef + 1 ORS.
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('cambio solo de codigoPostal: NO re-geocodifica (Georef no lo usa)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ codigoPostal: '9999' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.codigoPostal).toBe('9999');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('cambio de ubicación con cobertura fallando → 422 sin actualizar nada', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [9000],
      });
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Av. Lejana' });
      expect(res.statusCode).toBe(422);
      const persistida = await Direccion.findByPk(direccion.id);
      expect(persistida.calle).toBe('Av. Siempreviva');
    });

    it('no permite editar la dirección de otro cliente (403)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Hack' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/direcciones/:id', () => {
    it('baja lógica: activa pasa a false', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .delete(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(200);
      const persistida = await Direccion.findByPk(direccion.id);
      expect(persistida.activa).toBe(false);
    });

    it('no permite eliminar la dirección de otro cliente (403)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .delete(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(403);
    });
  });
});
