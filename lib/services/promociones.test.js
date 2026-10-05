import { calcularDescuento } from './promociones';

describe('promociones (cálculo de descuentos)', () => {
  test('porcentual aplica valor% sobre alcanzados', () => {
    const { descuentoTotal, porPromocion } = calcularDescuento(
      [{ productoId: 1, precioUnitario: 1000, cantidad: 2 }],
      [{ id: 1, tipo: 'DESCUENTO_PORCENTUAL', valor: 10, productoIds: [1] }]
    );
    expect(descuentoTotal).toBe(200);
    expect(porPromocion).toEqual([{ promocionId: 1, descuento: 200 }]);
  });

  test('porcentual ignora líneas no alcanzadas', () => {
    const { descuentoTotal } = calcularDescuento(
      [
        { productoId: 1, precioUnitario: 1000, cantidad: 1 },
        { productoId: 2, precioUnitario: 500, cantidad: 1 },
      ],
      [{ id: 1, tipo: 'DESCUENTO_PORCENTUAL', valor: 10, productoIds: [1] }]
    );
    expect(descuentoTotal).toBe(100);
  });

  test('2x1 regala una unidad por par (impar paga la restante)', () => {
    const par = calcularDescuento(
      [{ productoId: 1, precioUnitario: 900, cantidad: 2 }],
      [{ id: 1, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [1] }]
    );
    expect(par.descuentoTotal).toBe(900);

    const impar = calcularDescuento(
      [{ productoId: 1, precioUnitario: 900, cantidad: 3 }],
      [{ id: 1, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [1] }]
    );
    expect(impar.descuentoTotal).toBe(900);

    const uno = calcularDescuento(
      [{ productoId: 1, precioUnitario: 900, cantidad: 1 }],
      [{ id: 1, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [1] }]
    );
    expect(uno.descuentoTotal).toBe(0);
    expect(uno.porPromocion).toEqual([]);
  });

  test('misma línea: gana el mayor descuento sin duplicar', () => {
    const { descuentoTotal, porPromocion } = calcularDescuento(
      [{ productoId: 1, precioUnitario: 1000, cantidad: 2 }],
      [
        { id: 1, tipo: 'DESCUENTO_PORCENTUAL', valor: 10, productoIds: [1] },
        { id: 2, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [1] },
      ]
    );
    // 10% = 200 vs 2x1 = 1000 → gana 2x1
    expect(descuentoTotal).toBe(1000);
    expect(porPromocion).toEqual([{ promocionId: 2, descuento: 1000 }]);
  });

  test('sin líneas o sin promos no descuenta', () => {
    expect(
      calcularDescuento(
        [],
        [{ id: 1, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [1] }]
      )
    ).toEqual({
      descuentoTotal: 0,
      porPromocion: [],
    });
    expect(
      calcularDescuento(
        [{ productoId: 1, precioUnitario: 1000, cantidad: 1 }],
        []
      )
    ).toEqual({ descuentoTotal: 0, porPromocion: [] });
  });

  // El combo ya es la promoción respecto de sus componentes: su línea nunca
  // baja de precio, ni aunque una promo lo alcance directo o por sus componentes.
  test('un combo nunca se descuenta', () => {
    const directo = calcularDescuento(
      [{ productoId: 9, precioUnitario: 3200, cantidad: 2, tipo: 'COMBO' }],
      [{ id: 1, tipo: 'DESCUENTO_PORCENTUAL', valor: 10, productoIds: [9] }]
    );
    expect(directo.descuentoTotal).toBe(0);
    expect(directo.porPromocion).toEqual([]);

    const dosPorUno = calcularDescuento(
      [{ productoId: 9, precioUnitario: 3200, cantidad: 2, tipo: 'COMBO' }],
      [{ id: 2, tipo: 'DOS_POR_UNO', valor: 50, productoIds: [9] }]
    );
    expect(dosPorUno.descuentoTotal).toBe(0);
  });

  test('un combo no arrastra el descuento de sus componentes', () => {
    const { descuentoTotal, porPromocion } = calcularDescuento(
      [
        { productoId: 9, precioUnitario: 3200, cantidad: 1, tipo: 'COMBO' },
        { productoId: 2, precioUnitario: 500, cantidad: 1, tipo: 'PRODUCTO' },
      ],
      [{ id: 1, tipo: 'DESCUENTO_PORCENTUAL', valor: 10, productoIds: [2] }]
    );
    // Solo la línea del producto simple se descuenta (50); el combo no.
    expect(descuentoTotal).toBe(50);
    expect(porPromocion).toEqual([{ promocionId: 1, descuento: 50 }]);
  });
});
