/**
 * Tests de eta_service (T2 del plan maestro de pedidos).
 *
 * El cálculo del ETA usa routing_service.calcularRuta (ORS) para obtener la
 * duración del viaje. Se mockea el SERVICE (no node-fetch): el test es
 * unitario y rápido.
 */

jest.mock('./routing_service', () => ({
  calcularRuta: jest.fn(),
}));
import { calcularRuta } from './routing_service';
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

  test('cocina 30 min + viaje 10 min → ETA 40 min', async () => {
    // ORS: 600 segundos = 10 minutos de viaje.
    calcularRuta.mockResolvedValue({
      distanciaMetros: 1500,
      duracionSegundos: 600,
      geometria: null,
    });
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBeTruthy();
    expect(eta.etaMinutos).toBe(40); // 30 cocina + 10 viaje
    expect(eta.etaCalculadoEn).toBeInstanceOf(Date);
  });

  test('viaje de 45 segundos → redondea hacia arriba: 31 min total', async () => {
    calcularRuta.mockResolvedValue({
      distanciaMetros: 300,
      duracionSegundos: 45,
      geometria: null,
    });
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta.etaMinutos).toBe(31); // 30 + ceil(45/60) = 30 + 1
  });

  test('ORS caído → null (degradación, no bloquea)', async () => {
    calcularRuta.mockRejectedValue(new Error('ORS timeout'));
    const eta = await calcularEta({
      sucursal: SUCURSAL,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
  });

  test('sin sucursal → null', async () => {
    const eta = await calcularEta({
      sucursal: null,
      coordenadasEntrega: ENTREGA,
    });
    expect(eta).toBe(null);
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
