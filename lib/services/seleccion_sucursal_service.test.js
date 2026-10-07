/**
 * Tests de seleccion_sucursal_service (T1 del plan maestro de pedidos).
 *
 * Regla: LA MÁS CERCANA POR RUTA con stock suficiente, dentro de cobertura.
 * Verifica todos los casos límite del enunciado.
 *
 * Se mockea `cobertura_service.sucursalesEnCobertura` (no node-fetch): el
 * test es UNITARIO del service de selección — la lógica de ORS/distancias
 * ya está testeada en cobertura_service.test.js y routing_service.test.js.
 * El mock de stock (`faltantesDePedido`) también es unitario.
 */

jest.mock('./cobertura_service', () => ({
  sucursalesEnCobertura: jest.fn(),
}));
import { sucursalesEnCobertura } from './cobertura_service';

// No importamos el real: lo mockeamos con jest.mock en línea.
jest.mock('./stock', () => ({
  faltantesDePedido: jest.fn(),
}));
import { faltantesDePedido } from './stock';

import {
  seleccionarSucursal,
  SinSucursalElegibleError,
} from './seleccion_sucursal_service';

const COORDS = { latitud: -34.6037, longitud: -58.3816 };
const LINEAS = [{ productoId: 1, cantidad: 2, subtotal: 3000 }];

/**
 * Configura los mocks: el ranking de cobertura devuelve las sucursales con
 * sus distancias (ordenadas ascendente); el stock devuelve si cada sucursal
 * tiene o no faltantes.
 */
function configurar({ enCobertura = [], faltantesPorSucursal = {} } = {}) {
  sucursalesEnCobertura.mockResolvedValue(
    enCobertura.map(({ sucursal, distanciaMetros }) => ({
      sucursal,
      distanciaMetros,
    }))
  );
  faltantesDePedido.mockImplementation(
    async (lineas, sucursalId) => faltantesPorSucursal[sucursalId] || []
  );
}

describe('seleccion_sucursal_service (T1: más cercana con stock)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('varias elegibles con stock → la MÁS CERCANA (primera del ranking)', async () => {
    const cerca = { id: 1, nombre: 'Cerca', activa: true };
    const lejos = { id: 2, nombre: 'Lejos', activa: true };
    // El ranking ya viene ordenado por distancia: cerca (1000m) < lejos (3000m).
    configurar({
      enCobertura: [
        { sucursal: cerca, distanciaMetros: 1000 },
        { sucursal: lejos, distanciaMetros: 3000 },
      ],
      faltantesPorSucursal: { 1: [], 2: [] }, // ambas con stock
    });
    const elegida = await seleccionarSucursal({
      lineas: LINEAS,
      coordenadas: COORDS,
    });
    expect(elegida.id).toBe(1); // la más cercana
  });

  test('la más cercana SIN stock → la SIGUIENTE más cercana con stock', async () => {
    const cercaSinStock = { id: 1, nombre: 'CercaSinStock', activa: true };
    const lejosConStock = { id: 2, nombre: 'LejosConStock', activa: true };
    configurar({
      enCobertura: [
        { sucursal: cercaSinStock, distanciaMetros: 1000 },
        { sucursal: lejosConStock, distanciaMetros: 3000 },
      ],
      // id 1 tiene faltantes; id 2 tiene todo.
      faltantesPorSucursal: {
        1: [{ productoId: 1, faltante: 2 }],
        2: [],
      },
    });
    const elegida = await seleccionarSucursal({
      lineas: LINEAS,
      coordenadas: COORDS,
    });
    expect(elegida.id).toBe(2); // la siguiente con stock
  });

  test('ninguna dentro de cobertura → SinSucursalElegibleError', async () => {
    configurar({ enCobertura: [] });
    await expect(
      seleccionarSucursal({ lineas: LINEAS, coordenadas: COORDS })
    ).rejects.toThrow(/cobertura/i);
  });

  test('dentro de cobertura pero NINGUNA con stock → SinSucursalElegibleError', async () => {
    const s1 = { id: 1, activa: true };
    configurar({
      enCobertura: [{ sucursal: s1, distanciaMetros: 1000 }],
      faltantesPorSucursal: { 1: [{ productoId: 1, faltante: 2 }] },
    });
    await expect(
      seleccionarSucursal({ lineas: LINEAS, coordenadas: COORDS })
    ).rejects.toThrow(/stock dentro de la cobertura/i);
  });

  test('única sucursal elegible → esa', async () => {
    const unica = { id: 5, nombre: 'Única', activa: true };
    configurar({
      enCobertura: [{ sucursal: unica, distanciaMetros: 2000 }],
      faltantesPorSucursal: { 5: [] },
    });
    const elegida = await seleccionarSucursal({
      lineas: LINEAS,
      coordenadas: COORDS,
    });
    expect(elegida.id).toBe(5);
  });

  test('sucursal preferida válida (cobertura + stock) → se respeta', async () => {
    const preferida = { id: 3, nombre: 'Preferida', activa: true };
    const otra = { id: 1, nombre: 'Otra', activa: true };
    configurar({
      enCobertura: [
        { sucursal: otra, distanciaMetros: 500 },
        { sucursal: preferida, distanciaMetros: 2000 },
      ],
      faltantesPorSucursal: { 1: [], 3: [] },
    });
    const elegida = await seleccionarSucursal({
      lineas: LINEAS,
      coordenadas: COORDS,
      sucursalPreferida: preferida,
    });
    // Aunque 'otra' está más cerca, se respeta la preferida (válida).
    expect(elegida.id).toBe(3);
  });

  test('sucursal preferida FUERA de cobertura → SinSucursalElegibleError', async () => {
    const preferidaLejos = { id: 9, nombre: 'PreferidaLejos', activa: true };
    const enCobertura = { id: 1, nombre: 'Dentro', activa: true };
    configurar({
      enCobertura: [{ sucursal: enCobertura, distanciaMetros: 500 }],
      faltantesPorSucursal: { 1: [] },
    });
    // La preferida (id 9) NO está en el ranking de cobertura.
    await expect(
      seleccionarSucursal({
        lineas: LINEAS,
        coordenadas: COORDS,
        sucursalPreferida: preferidaLejos,
      })
    ).rejects.toThrow(/cobertura/i);
  });

  test('sucursal preferida con stock INSUFICIENTE → SinSucursalElegibleError', async () => {
    const preferidaSinStock = {
      id: 2,
      nombre: 'PreferidaSinStock',
      activa: true,
    };
    configurar({
      enCobertura: [{ sucursal: preferidaSinStock, distanciaMetros: 500 }],
      faltantesPorSucursal: { 2: [{ productoId: 1, faltante: 5 }] },
    });
    await expect(
      seleccionarSucursal({
        lineas: LINEAS,
        coordenadas: COORDS,
        sucursalPreferida: preferidaSinStock,
      })
    ).rejects.toThrow(/stock/i);
  });

  test('sin coordenadas de entrega → SinSucursalElegibleError', async () => {
    await expect(
      seleccionarSucursal({ lineas: LINEAS, coordenadas: null })
    ).rejects.toThrow(/coordenadas/i);
  });

  describe('exceptoSucursalId (reasignación automática al pagar)', () => {
    test('excluye la sucursal indicada aunque tenga stock: elige la siguiente', async () => {
      // Caso Vergara → Oeste: la original pierde la reserva y, aunque el
      // ranking la traiga primero (incluso con stock), se saltea.
      const original = { id: 1, nombre: 'Vergara', activa: true };
      const alternativa = { id: 2, nombre: 'Oeste', activa: true };
      configurar({
        enCobertura: [
          { sucursal: original, distanciaMetros: 1000 },
          { sucursal: alternativa, distanciaMetros: 4000 },
        ],
        faltantesPorSucursal: { 1: [], 2: [] },
      });
      const elegida = await seleccionarSucursal({
        lineas: LINEAS,
        coordenadas: COORDS,
        exceptoSucursalId: 1,
      });
      expect(elegida.id).toBe(2);
    });

    test('la sucursal excluida no se consulta por stock', async () => {
      const original = { id: 1, nombre: 'Vergara', activa: true };
      const alternativa = { id: 2, nombre: 'Oeste', activa: true };
      configurar({
        enCobertura: [
          { sucursal: original, distanciaMetros: 1000 },
          { sucursal: alternativa, distanciaMetros: 4000 },
        ],
        faltantesPorSucursal: { 1: [], 2: [] },
      });
      await seleccionarSucursal({
        lineas: LINEAS,
        coordenadas: COORDS,
        exceptoSucursalId: 1,
      });
      // Solo se consultó el stock de la alternativa, nunca el de la excluida.
      const idsConsultados = faltantesDePedido.mock.calls.map((c) => c[1]);
      expect(idsConsultados).toEqual([2]);
    });

    test('todas las candidatas excluidas → SinSucursalElegibleError sin faltantes', async () => {
      const original = { id: 1, nombre: 'Vergara', activa: true };
      configurar({
        enCobertura: [{ sucursal: original, distanciaMetros: 1000 }],
        faltantesPorSucursal: { 1: [] },
      });
      let errorCaugado = null;
      try {
        await seleccionarSucursal({
          lineas: LINEAS,
          coordenadas: COORDS,
          exceptoSucursalId: 1,
        });
      } catch (error) {
        errorCaugado = error;
      }
      expect(errorCaugado).toBeInstanceOf(SinSucursalElegibleError);
      expect(errorCaugado.faltantes).toBeUndefined();
    });
  });

  describe('faltantes informados cuando ninguna tiene stock', () => {
    test('el error lleva los faltantes de la candidata con MÁS unidades (10, no 4)', async () => {
      // Regresión del caso real: Coca-Cola en 4 y en 10; el cliente pedía 11.
      // Las dos sucursales deben el mismo producto, así que el desempate
      // mira las unidades y al cliente se le informa el máximo.
      const conCuatro = { id: 1, nombre: 'ConCuatro', activa: true };
      const conDiez = { id: 2, nombre: 'ConDiez', activa: true };
      configurar({
        enCobertura: [
          { sucursal: conCuatro, distanciaMetros: 1000 },
          { sucursal: conDiez, distanciaMetros: 3000 },
        ],
        faltantesPorSucursal: {
          1: [{ productoId: 1, nombre: 'Coca-Cola', hay: 4, necesario: 11 }],
          2: [{ productoId: 1, nombre: 'Coca-Cola', hay: 10, necesario: 11 }],
        },
      });
      let errorCaugado = null;
      try {
        await seleccionarSucursal({
          lineas: LINEAS,
          coordenadas: COORDS,
        });
      } catch (error) {
        errorCaugado = error;
      }
      expect(errorCaugado).toBeInstanceOf(SinSucursalElegibleError);
      expect(errorCaugado.faltantes).toEqual([
        { productoId: 1, nombre: 'Coca-Cola', hay: 10, necesario: 11 },
      ]);
    });

    test('gana la candidata con MENOS productos faltantes (prioridad sobre las unidades)', async () => {
      const conDosFaltantes = { id: 1, nombre: 'DosFaltantes', activa: true };
      const conUnFaltante = { id: 2, nombre: 'UnFaltante', activa: true };
      configurar({
        enCobertura: [
          { sucursal: conDosFaltantes, distanciaMetros: 1000 },
          { sucursal: conUnFaltante, distanciaMetros: 3000 },
        ],
        faltantesPorSucursal: {
          1: [
            { productoId: 1, nombre: 'Coca-Cola', hay: 50, necesario: 60 },
            { productoId: 2, nombre: 'Papas', hay: 50, necesario: 60 },
          ],
          2: [{ productoId: 3, nombre: 'Helado', hay: 2, necesario: 5 }],
        },
      });
      let errorCaugado = null;
      try {
        await seleccionarSucursal({
          lineas: LINEAS,
          coordenadas: COORDS,
        });
      } catch (error) {
        errorCaugado = error;
      }
      expect(errorCaugado.faltantes).toEqual([
        { productoId: 3, nombre: 'Helado', hay: 2, necesario: 5 },
      ]);
    });
  });
});
