import {
  ESTADOS_PEDIDO,
  esEstadoValido,
  obtenerEstadosSiguientes,
  puedeTransicionar,
  puedeTransicionarConRol,
} from './estados_pedido';

describe('estados_pedido', () => {
  test('pendiente puede ir a confirmado o cancelado', () => {
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.PENDIENTE, ESTADOS_PEDIDO.CONFIRMADO)
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.PENDIENTE, ESTADOS_PEDIDO.CANCELADO)
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

  test('solo se cancela antes de iniciar la preparación (pendiente/confirmado)', () => {
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.PENDIENTE, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.CONFIRMADO, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(true);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.EN_PREPARACION, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(false);
    expect(
      puedeTransicionar(
        ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR,
        ESTADOS_PEDIDO.CANCELADO
      )
    ).toBe(false);
    expect(
      puedeTransicionar(ESTADOS_PEDIDO.EN_CAMINO, ESTADOS_PEDIDO.CANCELADO)
    ).toBe(false);
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

  test('pendiente → confirmado solo CLIENTE dueño', () => {
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.PENDIENTE,
        ESTADOS_PEDIDO.CONFIRMADO,
        'CLIENTE',
        true
      )
    ).toBe(true);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.PENDIENTE,
        ESTADOS_PEDIDO.CONFIRMADO,
        'CLIENTE',
        false
      )
    ).toBe(false);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.PENDIENTE,
        ESTADOS_PEDIDO.CONFIRMADO,
        'ADMINISTRADOR',
        false
      )
    ).toBe(false);
  });

  test('flujo manual solo ADMIN, nunca CLIENTE', () => {
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.EN_PREPARACION,
        'ADMINISTRADOR'
      )
    ).toBe(true);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.EN_PREPARACION,
        'CLIENTE',
        true
      )
    ).toBe(false);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.EN_CAMINO,
        ESTADOS_PEDIDO.ENTREGADO,
        'ADMINISTRADOR'
      )
    ).toBe(true);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.EN_CAMINO,
        ESTADOS_PEDIDO.ENTREGADO,
        'CLIENTE',
        true
      )
    ).toBe(false);
  });

  test('cancelar: CLIENTE dueño o ADMIN', () => {
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.CANCELADO,
        'CLIENTE',
        true
      )
    ).toBe(true);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.CANCELADO,
        'CLIENTE',
        false
      )
    ).toBe(false);
    expect(
      puedeTransicionarConRol(
        ESTADOS_PEDIDO.CONFIRMADO,
        ESTADOS_PEDIDO.CANCELADO,
        'ADMINISTRADOR'
      )
    ).toBe(true);
  });
});
