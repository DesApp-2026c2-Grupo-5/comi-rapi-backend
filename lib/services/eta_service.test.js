/**
 * Tests de eta_service (T2 del plan maestro + A1-4).
 *
 * Desde A1-4 el ETA delega en distancias_service.obtenerOCalcularDistancia:
 * el caché decide si hay llamada al proveedor o no. Se mockea el SERVICE de
 * distancias (no el proveedor): el test es unitario y rápido; la lógica de
 * caché tiene su propia suite en distancias_service.test.js.
 */

jest.mock('./distancias_service', () => ({
  obtenerOCalcularDistancia: jest.fn(),
}));
import { obtenerOCalcularDistancia } from './distancias_service';
import { calcularEta } from './eta_service';

const SUCURSAL = {
  id: 1,
  direccion: { latitud: -34.6037, longitud: -58.3816 },
};

const ENTREGA = { latitud: -34.604, longitud: -58.382 };

describe('eta_service (T2: cocina + viaje)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('cocina 30 min + viaje 10 min (caché) → ETA 40 min', async () => {
    // El par ya estaba cacheado: 600 segundos = 10 minutos de viaje.
    obtenerOCalcularDistancia.mockResolvedValue({
      distanciaMetros: 1500,
      duracionSegundos: 600,
      deCache: true,
    });
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBeTruthy();
    expect(eta.etaMinutos).toBe(40); // 30 cocina + 10 viaje
    expect(eta.etaCalculadoEn).toBeInstanceOf(Date);
    expect(obtenerOCalcularDistancia).toHaveBeenCalledTimes(1);
    expect(obtenerOCalcularDistancia.mock.calls[0][0].sucursalId).toBe(1);
  });

  test('viaje de 45 segundos (calculado en vivo) → redondea hacia arriba: 31 min', async () => {
    obtenerOCalcularDistancia.mockResolvedValue({
      distanciaMetros: 300,
      duracionSegundos: 45,
      deCache: false,
    });
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta.etaMinutos).toBe(31); // 30 + ceil(45/60) = 30 + 1
  });

  test('fallo del proveedor (vía distancias) → null (degradación, no bloquea)', async () => {
    obtenerOCalcularDistancia.mockRejectedValue(new Error('ORS timeout'));
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
  });

  test('sin sucursal → null (sin consultar distancias)', async () => {
    const eta = await calcularEta({
      sucursal: null,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
    expect(obtenerOCalcularDistancia).not.toHaveBeenCalled();
  });

  test('sucursal sin dirección (sin coords) → null', async () => {
    const eta = await calcularEta({
      sucursal: { id: 1, direccion: null },
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
  });

  test('sucursal con dirección sin lat/lng → null', async () => {
    const eta = await calcularEta({
      sucursal: {
        id: 1,
        direccion: { latitud: null, longitud: null },
      },
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
  });

  test('sin coords de entrega → null', async () => {
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: null,
    });
    expect(eta).toBe(null);
  });
});
