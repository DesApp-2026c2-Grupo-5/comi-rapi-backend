/**
 * Tests de reasignacion_service (T4 del plan de pedidos).
 *
 * Se mockean las dependencias (cobertura, stock, eta) para probar la lógica
 * del service de forma unitaria. Los tests de integración del endpoint HTTP
 * están en pedido_controller.test.js.
 */

jest.mock('./cobertura_service', () => ({
  sucursalesEnCobertura: jest.fn(),
}));
jest.mock('./stock', () => ({
  reponerStock: jest.fn(),
  descontarStock: jest.fn(),
  faltantesDePedido: jest.fn(),
  StockInsuficienteError: class StockInsuficienteError extends Error {
    constructor(faltantes) {
      super('Stock insuficiente');
      this.name = 'StockInsuficienteError';
      this.faltantes = faltantes;
    }
  },
}));
jest.mock('./eta_service', () => ({
  calcularEta: jest.fn(),
}));
jest.mock('../models', () => {
  class FakeModel {
    constructor(data) {
      Object.assign(this, data);
    }
    async update(vals) {
      Object.assign(this, vals);
      return this;
    }
  }
  return {
    Pedido: FakeModel,
    Sucursal: Object.assign(FakeModel, { findByPk: jest.fn() }),
    PedidoEstadoHistorial: Object.assign(FakeModel, { create: jest.fn() }),
    Direccion: Object.assign(FakeModel, { findOne: jest.fn() }),
  };
});

import { sucursalesEnCobertura } from './cobertura_service';
import { faltantesDePedido, reponerStock, descontarStock } from './stock';
import { calcularEta } from './eta_service';
import db from '../models';
import {
  reasignarPedido,
  ReasignacionError,
  ESTADOS_REASIGNABLES,
} from './reasignacion_service';

const { Sucursal, PedidoEstadoHistorial } = db;

const t = { id: 1 }; // transacción fake

function pedidoFake({
  estado = 'confirmado',
  sucursalId = 1,
  latitud = -34.6037,
  longitud = -58.3816,
}) {
  return {
    id: 10,
    sucursalId,
    estadoId: 2,
    estadoActual: { nombre: estado },
    latitud,
    longitud,
    items: [{ productoId: 5, cantidad: 2 }],
    update: jest.fn().mockImplementation(function (vals) {
      Object.assign(this, vals);
      return Promise.resolve(this);
    }),
  };
}

function sucursalFake(id, nombre, activa = true) {
  return {
    id,
    nombre,
    activa,
    direccion: { latitud: -34.6, longitud: -58.38 },
  };
}

describe('reasignacion_service (T4: reasignación manual admin)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Fix: Direccion.findOne devuelve una dirección válida por defecto.
    db.Direccion.findOne.mockResolvedValue({
      latitud: -34.6,
      longitud: -58.38,
    });
  });

  test('reasigna correctamente: transfiere stock, actualiza pedido, registra trazabilidad y recalcula ETA', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    const nueva = sucursalFake(2, 'Sucursal Norte');
    const vieja = sucursalFake(1, 'Sucursal Centro');
    Sucursal.findByPk.mockImplementation((id) =>
      Promise.resolve(id === 2 ? nueva : vieja)
    );
    sucursalesEnCobertura.mockResolvedValue([
      { sucursal: vieja, distanciaMetros: 800 },
      { sucursal: nueva, distanciaMetros: 2000 },
    ]);
    faltantesDePedido.mockResolvedValue([]);
    calcularEta.mockResolvedValue({
      etaMinutos: 35,
      etaCalculadoEn: new Date(),
    });

    await reasignarPedido({
      pedido,
      nuevaSucursalId: 2,
      adminEmail: 'admin@test.com',
      transaction: t,
    });

    expect(reponerStock).toHaveBeenCalledWith(pedido.items, 1, {
      transaction: t,
    });
    expect(descontarStock).toHaveBeenCalledWith(pedido.items, 2, {
      transaction: t,
    });
    expect(pedido.sucursalId).toBe(2);
    expect(PedidoEstadoHistorial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pedidoId: 10,
        observacion: expect.stringMatching(
          /Reasignado de "Sucursal Centro" a "Sucursal Norte" por admin admin@test.com/
        ),
      }),
      { transaction: t }
    );
    expect(pedido.etaMinutos).toBe(35);
  });

  test('estado no reasignable (en_camino) → ReasignacionError 403', async () => {
    const pedido = pedidoFake({ estado: 'en_camino' });
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 2,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(ReasignacionError);
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 2,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/en_camino/);
  });

  test('misma sucursal → ReasignacionError 400', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 1,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/ya está asignado/);
  });

  test('sucursal inexistente o inactiva → ReasignacionError 404', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    Sucursal.findByPk.mockResolvedValue(null);
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 99,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/no existe o está inactiva/);
  });

  test('sucursal fuera de cobertura → ReasignacionError 422', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    Sucursal.findByPk.mockResolvedValue(sucursalFake(2, 'Lejos'));
    sucursalesEnCobertura.mockResolvedValue([]); // nadie en cobertura
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 2,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/fuera de la cobertura/);
  });

  test('sucursal con stock insuficiente → StockInsuficienteError (409 en el controller)', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    Sucursal.findByPk.mockResolvedValue(sucursalFake(2, 'SinStock'));
    sucursalesEnCobertura.mockResolvedValue([
      { sucursal: sucursalFake(2, 'SinStock'), distanciaMetros: 1000 },
    ]);
    faltantesDePedido.mockResolvedValue([
      { productoId: 5, hay: 0, necesario: 2 },
    ]);
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 2,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/Stock insuficiente/);
    // No se transferió nada
    expect(reponerStock).not.toHaveBeenCalled();
    expect(descontarStock).not.toHaveBeenCalled();
  });

  test('ORS falla al recalcular ETA → el pedido queda reasignado sin ETA (degradación)', async () => {
    const pedido = pedidoFake({ sucursalId: 1 });
    const nueva = sucursalFake(2, 'Sucursal Norte');
    const vieja = sucursalFake(1, 'Sucursal Centro');
    Sucursal.findByPk.mockImplementation((id) =>
      Promise.resolve(id === 2 ? nueva : vieja)
    );
    sucursalesEnCobertura.mockResolvedValue([
      { sucursal: nueva, distanciaMetros: 1500 },
    ]);
    faltantesDePedido.mockResolvedValue([]);
    calcularEta.mockResolvedValue(null); // ORS falló

    await reasignarPedido({
      pedido,
      nuevaSucursalId: 2,
      adminEmail: 'a@b.c',
      transaction: t,
    });
    expect(pedido.sucursalId).toBe(2);
    expect(pedido.etaMinutos).toBeUndefined(); // no se actualizó
  });

  test('pedido sin coordenadas → ReasignacionError 422', async () => {
    const pedido = pedidoFake({ latitud: null, longitud: null });
    await expect(
      reasignarPedido({
        pedido,
        nuevaSucursalId: 2,
        adminEmail: 'a@b.c',
        transaction: t,
      })
    ).rejects.toThrow(/coordenadas/);
  });

  test('ESTADOS_REASIGNABLES = pendiente, confirmado, en_preparacion', () => {
    expect(ESTADOS_REASIGNABLES).toEqual([
      'pendiente',
      'confirmado',
      'en_preparacion',
    ]);
  });
});
