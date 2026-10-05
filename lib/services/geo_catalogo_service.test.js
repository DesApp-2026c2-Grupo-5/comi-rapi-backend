/**
 * Tests de geo_catalogo_service (catálogo territorial, Iteración 3).
 *
 * La comunicación HTTP se mockea vía `node-fetch` (jest.mock): los tests NO
 * dependen de una conexión real a Georef. Se verifican el mapeo de
 * respuestas, la validación de entrada y la política de cache (una segunda
 * llamada con la misma clave NO vuelve a consultar Georef).
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
import {
  obtenerDepartamentos,
  obtenerLocalidades,
  buscarCalles,
  obtenerZonas,
  limpiarCache,
} from './geo_catalogo_service';

function respuestaOk(campo, entidades) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ total: entidades.length, [campo]: entidades }),
    text: async () => '',
  };
}

describe('geo_catalogo_service (Georef mockeada)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limpiarCache();
  });

  describe('obtenerDepartamentos', () => {
    test('devuelve los departamentos mapeados de la provincia', async () => {
      fetch.mockResolvedValue(
        respuestaOk('departamentos', [
          { id: '02007', nombre: 'Comuna 1' },
          { id: '02014', nombre: 'Comuna 2' },
        ])
      );
      const departamentos = await obtenerDepartamentos(
        'Ciudad Autónoma de Buenos Aires'
      );
      expect(departamentos).toEqual([
        { id: '02007', nombre: 'Comuna 1' },
        { id: '02014', nombre: 'Comuna 2' },
      ]);
      const url = fetch.mock.calls[0][0];
      expect(url).toContain('/api/departamentos?');
      expect(url).toContain('provincia=');
    });

    test('cache: la segunda llamada con la misma provincia NO consulta Georef', async () => {
      fetch.mockResolvedValue(
        respuestaOk('departamentos', [{ id: '06274', nombre: 'Quilmes' }])
      );
      await obtenerDepartamentos('Buenos Aires');
      await obtenerDepartamentos('Buenos Aires');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('cache: otra provincia es otra clave (vuelve a consultar)', async () => {
      fetch.mockResolvedValue(
        respuestaOk('departamentos', [{ id: '02007', nombre: 'Comuna 1' }])
      );
      await obtenerDepartamentos('Buenos Aires');
      await obtenerDepartamentos('Ciudad Autónoma de Buenos Aires');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('respeta mayúsculas/minúsculas en la clave de cache', async () => {
      fetch.mockResolvedValue(
        respuestaOk('departamentos', [
          { id: '06411', nombre: 'Tres de Febrero' },
        ])
      );
      await obtenerDepartamentos('Buenos Aires');
      await obtenerDepartamentos('BUENOS AIRES');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('obtenerLocalidades', () => {
    test('filtra por provincia y departamento (cascada)', async () => {
      fetch.mockResolvedValue(
        respuestaOk('localidades', [
          { id: '06411010010', nombre: 'Caseros' },
          { id: '06411010030', nombre: 'Ciudadela' },
        ])
      );
      const localidades = await obtenerLocalidades({
        provincia: 'Buenos Aires',
        departamento: 'Tres de Febrero',
      });
      expect(localidades.map((l) => l.nombre)).toEqual([
        'Caseros',
        'Ciudadela',
      ]);
      const url = fetch.mock.calls[0][0];
      expect(url).toContain('/api/localidades?');
      expect(url).toContain('departamento=');
    });

    test('sin departamento: solo filtra por provincia (CABA → barrios)', async () => {
      fetch.mockResolvedValue(
        respuestaOk('localidades', [{ id: '1', nombre: 'Palermo' }])
      );
      await obtenerLocalidades({
        provincia: 'Ciudad Autónoma de Buenos Aires',
      });
      const url = fetch.mock.calls[0][0];
      expect(url).not.toContain('departamento=');
    });
  });

  describe('buscarCalles', () => {
    test('autocompletado por nombre parcial con filtros opcionales', async () => {
      fetch.mockResolvedValue(
        respuestaOk('calles', [
          { id: '020700101', nombre: 'AV JUAN B JUSTO', categoria: 'AV' },
        ])
      );
      const calles = await buscarCalles({
        provincia: 'Ciudad Autónoma de Buenos Aires',
        departamento: 'Comuna 11',
        nombre: 'juan b',
      });
      expect(calles).toEqual([
        { id: '020700101', nombre: 'AV JUAN B JUSTO', categoria: 'AV' },
      ]);
      const url = fetch.mock.calls[0][0];
      expect(url).toContain('/api/calles?');
      expect(url).toContain('nombre=juan+b');
    });

    test('cache de autocompletado: mismo prefijo NO consulta dos veces', async () => {
      fetch.mockResolvedValue(respuestaOk('calles', []));
      await buscarCalles({ provincia: 'Buenos Aires', nombre: 'liber' });
      await buscarCalles({ provincia: 'Buenos Aires', nombre: 'liber' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    // Regresión del 503 (post-iteración 5): /api/calles NO acepta el filtro
    // `localidad` (solo /api/direcciones). Reenviarlo producía un 400 de
    // Georef traducido (engañosamente) a "servicio no disponible".
    test('NO reenvía localidad a /api/calles aunque se reciba (regresión 503)', async () => {
      fetch.mockResolvedValue(
        respuestaOk('calles', [
          { id: '0653901005150', nombre: 'MATACO', categoria: 'CALLE' },
        ])
      );
      await buscarCalles({
        provincia: 'Buenos Aires',
        departamento: 'Merlo',
        localidad: 'Libertad',
        nombre: 'mataco',
      });
      const url = fetch.mock.calls[0][0];
      expect(url).toContain('nombre=mataco');
      expect(url).toContain('departamento=Merlo');
      expect(url).not.toContain('localidad=');
    });
  });

  describe('obtenerZonas', () => {
    test('deriva de la configuración de cobertura SIN llamar a Georef', () => {
      const zonas = obtenerZonas();
      expect(fetch).not.toHaveBeenCalled();
      const nombres = zonas.map((z) => z.nombre);
      expect(nombres).toContain('CABA');
      expect(nombres).toContain('AMBA');
      const amba = zonas.find((z) => z.nombre === 'AMBA');
      expect(amba.provincias).toContain('Buenos Aires');
      expect(amba.departamentos).toContain('Tres de Febrero');
      // Tarea 7: contrato de la iteración 4 — la zona AMBA contiene los 40
      // partidos completos de la definición INDEC (regresión de la config).
      expect(amba.departamentos).toHaveLength(40);
      expect(amba.departamentos).toContain('La Plata');
      expect(amba.departamentos).toContain('Zárate');
      expect(amba.departamentos).toContain('Presidente Perón');
    });
  });
});
