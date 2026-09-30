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
});
