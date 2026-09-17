import {
  ESTADOS_PEDIDO,
  esEstadoValido,
  obtenerEstadosSiguientes,
  puedeTransicionar,
} from './estados_pedido';

describe('estados_pedido', () => {
  test('pendiente solo puede ir a confirmado', () => {
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.PENDIENTE, ESTADOS_PEDIDO.CONFIRMADO)
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.PENDIENTE, ESTADOS_PEDIDO.ENTREGADO)
    ).toBe(false);
  });

  test('flujo admin confirmado → en_preparacion → listo → en_camino → entregado', () => {
    expect(
      puedeTransicionar(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.EN_PREPARACION
      )
    ).toBe(true);
    expect(
      puedeTransicionar(
        ESTADOS_PEDIDO.EN_PREPARACION,
        ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR
      )
    ).toBe(true);
    expect(
      puedeTransicionar(
        ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR,
        ESTADOS_PEDIDO.EN_CAMINO
      )
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.EN_CAMINO, ESTADOS_PEDIDO.ENTREGADO)
    ).toBe(true);
  });

  test('cancelado es válido desde estados intermedios pero no desde finales', () => {
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.CONFIRMADO, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.ENTREGADO, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(false);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.CANCELADO, ESTADOS_PEDIDO.CONFIRMADO)
    ).toBe(false);
  });

  test('estados finales no tienen siguientes', () => {
    expect(obtenerEstadosSiguientes(ESTADOS_PEDIDO.ENTREGADO)).toEqual([]);
    expect(obtenerEstadosSiguientes(ESTADOS_PEDIDO.CANCELADO)).toEqual([]);
  });

  test('obtenerSiguientes de confirmado', () => {
    expect(obtenerEstadosSiguientes(ESTADOS_PEDIDO.CONFIRMADO)).toEqual([
      ESTADOS_PEDIDO.EN_PREPARACION,
      ESTADOS_PEDIDO.CANCELADO,
    ]);
  });

  test('esEstadoValido rechaza desconocidos', () => {
    expect(esEstadoValido('pendiente')).toBe(true);
    expect(esEstadoValido('inexistente')).toBe(false);
  });
});
