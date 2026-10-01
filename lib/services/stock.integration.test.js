import { cleanDb } from '../../test/db_utils';
import db from '../models';
import {
  combosOfrecidos,
  descontarStock,
  inicializarStockDeCombo,
  maximoDeCombosPorSucursal,
  mensajeDeFaltantes,
  mensajeDeReservasVencidas,
  reservasDeStockVencidas,
  reponerStock,
} from './stock';

const { Categoria, ComboComponente, Producto, Stock, Sucursal } = db;

// El texto que ve el cliente no depende de la base, así que se prueba sola.
describe('mensajeDeFaltantes', () => {
  test('sin faltantes igual cierra con la instrucción de actualizar', () => {
    expect(mensajeDeFaltantes([])).toBe(
      'No hay stock de tu pedido. Actualizá el carrito para confirmar de nuevo.'
    );
  });

  test('un solo producto sin stock', () => {
    expect(
      mensajeDeFaltantes([{ nombre: 'Empanada', hay: 0, necesario: 1 }])
    ).toBe(
      'No nos queda stock de Empanada. Actualizá el carrito para confirmar el pedido.'
    );
  });

  test('varios sin stock se enumeran con "y"', () => {
    expect(
      mensajeDeFaltantes([
        { nombre: 'Empanada', hay: 0, necesario: 1 },
        { nombre: 'Bebida', hay: 0, necesario: 2 },
        { nombre: 'Papa', hay: 0, necesario: 1 },
      ])
    ).toBe(
      'No nos queda stock de Empanada, Bebida y Papa. Actualizá el carrito para confirmar el pedido.'
    );
  });

  test('faltante parcial: dice cuántos quedan', () => {
    expect(
      mensajeDeFaltantes([{ nombre: 'Empanada', hay: 1, necesario: 3 }])
    ).toBe(
      'De Empanada sólo queda 1 y pediste 3. Actualizá el carrito para confirmar el pedido.'
    );
  });

  test('mezcla de faltantes totales y parciales', () => {
    expect(
      mensajeDeFaltantes([
        { nombre: 'Bebida', hay: 0, necesario: 1 },
        { nombre: 'Empanada', hay: 4, necesario: 6 },
      ])
    ).toBe(
      'No nos queda stock de Bebida. De Empanada sólo quedan 4 y pediste 6. Actualizá el carrito para confirmar el pedido.'
    );
  });

  test('concuerda "queda" con 1 y "quedan" con más de 1', () => {
    expect(mensajeDeFaltantes([{ nombre: 'A', hay: 2, necesario: 5 }])).toMatch(
      /sólo quedan 2/
    );
    expect(mensajeDeFaltantes([{ nombre: 'A', hay: 1, necesario: 5 }])).toMatch(
      /sólo queda 1 y/
    );
  });

  test('nunca usa jerga ni el detalle interno (hay X, se necesitan Y)', () => {
    const texto = mensajeDeFaltantes([
      { nombre: 'Empanada', hay: 0, necesario: 3 },
      { nombre: 'Combo Doble', hay: 1, necesario: 2 },
    ]);
    expect(texto).not.toMatch(/insuficiente/i);
    expect(texto).not.toMatch(/Stock:/);
    expect(texto).not.toMatch(/se necesitan/);
  });
});

describe('stock (descuento y reposición contra la base)', () => {
  let sucursal;
  let combo;
  let componenteA;
  let componenteB;
  let simple;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Combos',
      descripcion: 'Test',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Test' });
    simple = await Producto.create({
      nombre: 'Empanada',
      precio: 1000,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    componenteA = await Producto.create({
      nombre: 'Papas',
      precio: 800,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    componenteB = await Producto.create({
      nombre: 'Bebida',
      precio: 900,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    combo = await Producto.create({
      nombre: 'Combo Doble',
      precio: 2500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'COMBO',
    });
    await ComboComponente.bulkCreate([
      { comboId: combo.id, productoId: componenteA.id, cantidad: 2 },
      { comboId: combo.id, productoId: componenteB.id, cantidad: 1 },
    ]);
  });

  const cargar = (productoId, cantidad) =>
    Stock.create({
      sucursalId: sucursal.id,
      productoId,
      cantidad,
      disponible: true,
    });

  const cantidadDe = async (productoId) => {
    const stock = await Stock.findOne({
      where: { sucursalId: sucursal.id, productoId },
    });
    return stock ? stock.cantidad : null;
  };

  afterEach(async () => {
    await Stock.destroy({ where: {} });
  });

  test('descontar un combo descuenta el combo y los componentes', async () => {
    await cargar(combo.id, 10);
    await cargar(componenteA.id, 20);
    await cargar(componenteB.id, 30);

    await descontarStock([{ productoId: combo.id, cantidad: 2 }], sucursal.id);

    // El combo descuenta su propia unidad, y la receta multiplicada (2 papas).
    expect(await cantidadDe(combo.id)).toBe(8);
    expect(await cantidadDe(componenteA.id)).toBe(16);
    expect(await cantidadDe(componenteB.id)).toBe(28);
  });

  test('descontar respeta el stock real de los componentes', async () => {
    // El combo dice 10, pero con 6 papas (3 por combo) solo salen 3.
    await cargar(combo.id, 10);
    await cargar(componenteA.id, 6);
    await cargar(componenteB.id, 30);

    expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(3);
    await descontarStock([{ productoId: combo.id, cantidad: 3 }], sucursal.id);
    expect(await cantidadDe(componenteA.id)).toBe(0);
  });

  // `disponibles` del endpoint de disponibilidad sale de acá: son los combos que
  // se venden de verdad, no los que el admin dejó en venta.
  describe('combosOfrecidos (lo que devuelve "disponibles")', () => {
    test('acota por el stock de los componentes', async () => {
      await cargar(combo.id, 10);
      await cargar(componenteA.id, 100);
      await cargar(componenteB.id, 4);

      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(4);
    });

    test('acota por la cantidad que el admin puso en venta', async () => {
      await cargar(combo.id, 2);
      await cargar(componenteA.id, 100);
      await cargar(componenteB.id, 100);

      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(2);
    });

    test('es 0 si al combo no lo ofrece la sucursal', async () => {
      await Stock.create({
        sucursalId: sucursal.id,
        productoId: combo.id,
        cantidad: 10,
        disponible: false,
      });
      await cargar(componenteA.id, 100);
      await cargar(componenteB.id, 100);

      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(0);
    });

    test('es 0 si el combo no tiene fila de stock en la sucursal', async () => {
      await cargar(componenteA.id, 100);
      await cargar(componenteB.id, 100);

      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(0);
    });

    test('es 0 si al componente le falta stock', async () => {
      await cargar(combo.id, 10);
      await cargar(componenteA.id, 100);
      // La bebida no tiene fila en esta sucursal.

      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(0);
    });
  });

  test('rechaza el pedido cuando no alcanza el stock', async () => {
    await cargar(simple.id, 2);

    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 5 }], sucursal.id)
    ).rejects.toThrow(
      'De Empanada sólo quedan 2 y pediste 5. Actualizá el carrito para confirmar el pedido.'
    );
    // La transacción del caller hace rollback; acá solo se verifica el rechazo.
  });

  test('un producto sin fila de stock no se puede pedir', async () => {
    await expect(
      descontarStock([{ productoId: componenteB.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow('No nos queda stock de Bebida.');
  });

  test('stock cargado en 0 o no disponible se trata como faltante', async () => {
    await cargar(simple.id, 0);
    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow('No nos queda stock de Empanada.');

    await Stock.update({ cantidad: 5, disponible: false }, { where: {} });
    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow('No nos queda stock de Empanada.');
  });

  test('el mensaje de stock no menciona los componentes del combo', async () => {
    await cargar(combo.id, 10);
    // La receta pide 2 Papas y 1 Bebida: de este stock da para 1 combo, aunque
    // la fila del combo diga 10. El cliente tiene que ver ese 1, no el 10.
    await cargar(componenteA.id, 3);
    await cargar(componenteB.id, 10);

    const error = await descontarStock(
      [{ productoId: combo.id, cantidad: 4 }],
      sucursal.id
    ).catch((e) => e);

    // Lo que ve el cliente es el combo, no "Papas" ni "Bebida".
    expect(error.message).toBe(
      'De Combo Doble sólo queda 1 y pediste 4. Actualizá el carrito para confirmar el pedido.'
    );
    expect(error.message).not.toMatch(/Papas/);
    expect(error.message).not.toMatch(/Bebida/);
    expect(error.faltantes).toEqual([
      {
        productoId: combo.id,
        nombre: 'Combo Doble',
        hay: 1,
        necesario: 4,
      },
    ]);
  });

  test('un combo que no se ofrece en la sucursal se informa sin jerga', async () => {
    await expect(
      descontarStock([{ productoId: combo.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow('No nos queda stock de Combo Doble.');
  });

  test('una lista vacía de líneas controlables no toca el stock', async () => {
    // Las líneas ad-hoc (sin `productoId`) las filtra el controller con
    // `lineasControlables`; acá el service solo recibe lo que hay que controlar.
    await expect(descontarStock([], sucursal.id)).resolves.toBeUndefined();
    await expect(reponerStock([], sucursal.id)).resolves.toBeUndefined();
  });

  test('una línea sin productoId se rechaza (el filtrado es del controller)', async () => {
    await expect(
      descontarStock(
        [{ nombre: 'Extra', precioUnitario: 500, cantidad: 2 }],
        sucursal.id
      )
    ).rejects.toThrow(/producto undefined no existe/);
  });

  test('reponer suma sobre una fila existente', async () => {
    await cargar(simple.id, 3);

    await reponerStock([{ productoId: simple.id, cantidad: 2 }], sucursal.id);

    expect(await cantidadDe(simple.id)).toBe(5);
  });

  test('reponer suma aunque la fila valga justo lo que se repone', async () => {
    // Regresión: comparar contra el total hacía que la reposición se salte y
    // el stock quedara en 2 en vez de subir a 4.
    await cargar(simple.id, 2);

    await reponerStock([{ productoId: simple.id, cantidad: 2 }], sucursal.id);

    expect(await cantidadDe(simple.id)).toBe(4);
  });

  test('descontar y reponer dejan el stock donde estaba', async () => {
    await cargar(combo.id, 5);
    await cargar(componenteA.id, 10);
    await cargar(componenteB.id, 10);
    const items = [{ productoId: combo.id, cantidad: 2 }];

    await descontarStock(items, sucursal.id);
    await reponerStock(items, sucursal.id);

    expect(await cantidadDe(combo.id)).toBe(5);
    expect(await cantidadDe(componenteA.id)).toBe(10);
    expect(await cantidadDe(componenteB.id)).toBe(10);
  });

  test('reponer crea la fila si el producto ya no está en el catálogo de la sucursal', async () => {
    // Cancelar un pedido viejo tiene que poder completarse aunque después se
    // haya sacado el producto de la sucursal.
    await reponerStock(
      [{ productoId: componenteB.id, cantidad: 4 }],
      sucursal.id
    );

    expect(await cantidadDe(componenteB.id)).toBe(4);
  });

  test('el máximo de combos sale de la receta, no del stock del combo', async () => {
    await cargar(combo.id, 100);
    await cargar(componenteA.id, 8);
    await cargar(componenteB.id, 100);

    // 8 papas, 2 por combo.
    expect(await maximoDeCombosPorSucursal(combo.id, sucursal.id)).toBe(4);
  });

  test('un combo sin receta no se puede armar', async () => {
    const comboSinReceta = await Producto.create({
      nombre: 'Combo vacío',
      precio: 1000,
      categoriaId: (await Categoria.findOne()).id,
      activo: true,
      tipo: 'COMBO',
    });
    await cargar(comboSinReceta.id, 10);

    expect(
      await maximoDeCombosPorSucursal(comboSinReceta.id, sucursal.id)
    ).toBe(0);
  });

  // Regresión del alta de combos: un combo sin fila en `Stocks` no se podía
  // comprar en ninguna sucursal, aunque sus componentes tuvieran stock, y el
  // cliente se enteraba con un "stock insuficiente" recién al pagar.
  describe('inicializarStockDeCombo', () => {
    const receta = () => [
      { productoId: componenteA.id, cantidad: 2 },
      { productoId: componenteB.id, cantidad: 1 },
    ];

    test('da de alta el combo en las sucursales activas con el stock que hay', async () => {
      await cargar(componenteA.id, 8);
      await cargar(componenteB.id, 100);

      const creadas = await inicializarStockDeCombo(combo.id, receta());

      expect(creadas).toHaveLength(1);
      // 8 papas, 2 por combo.
      expect(await cantidadDe(combo.id)).toBe(4);
      expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(4);
    });

    test('con el combo inicializado el pedido pasa', async () => {
      await cargar(componenteA.id, 8);
      await cargar(componenteB.id, 100);
      await inicializarStockDeCombo(combo.id, receta());

      await expect(
        descontarStock([{ productoId: combo.id, cantidad: 1 }], sucursal.id)
      ).resolves.toBeUndefined();

      expect(await cantidadDe(combo.id)).toBe(3);
      expect(await cantidadDe(componenteA.id)).toBe(6);
      expect(await cantidadDe(componenteB.id)).toBe(99);
    });

    test('no pisa un tope que el admin ya cargó', async () => {
      await cargar(combo.id, 2);
      await cargar(componenteA.id, 8);
      await cargar(componenteB.id, 100);

      const creadas = await inicializarStockDeCombo(combo.id, receta());

      expect(creadas).toHaveLength(0);
      expect(await cantidadDe(combo.id)).toBe(2);
    });

    test('entra con 0 si los componentes no alcanzan', async () => {
      await cargar(componenteA.id, 1);

      await inicializarStockDeCombo(combo.id, receta());

      // El topping se crea igual, para que el admin lo vea en la pantalla de
      // Stock; lo que no alcanza sale del propio stock de los componentes.
      expect(await cantidadDe(combo.id)).toBe(0);
      await expect(
        descontarStock([{ productoId: combo.id, cantidad: 1 }], sucursal.id)
      ).rejects.toThrow('No nos queda stock de Combo Doble.');
    });
  });

  // El caso que reportó el usuario: el pedido reserva el stock al crearse, el
  // admin desactiva ese stock antes del pago y, al confirmar, el pedido pasaba
  // igual. Estas pruebas cubren la revisión que faltaba.
  describe('reservasDeStockVencidas (control al confirmar el pago)', () => {
    // Función y no constante: `combo` recién existe después del `beforeAll`.
    const comboItem = () => [{ productoId: combo.id, cantidad: 1 }];

    // Deja el stock como quedaría con un pedido pendiente de un combo ya
    // descontado: el combo y sus componentes con una unidad menos.
    const pedidoPendienteDeCombo = async () => {
      await cargar(combo.id, 10);
      await cargar(componenteA.id, 20);
      await cargar(componenteB.id, 100);
      await descontarStock(comboItem(), sucursal.id);
    };

    test('la reserva intacta no vence', async () => {
      await pedidoPendienteDeCombo();

      expect(await reservasDeStockVencidas(comboItem(), sucursal.id)).toEqual(
        []
      );
    });

    test('vence si el admin desactiva el stock del combo', async () => {
      await pedidoPendienteDeCombo();
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursal.id, productoId: combo.id } }
      );

      expect(await reservasDeStockVencidas(comboItem(), sucursal.id)).toEqual([
        { productoId: combo.id, nombre: 'Combo Doble' },
      ]);
    });

    test('vence si el admin baja la cantidad por debajo de lo reservado', async () => {
      await pedidoPendienteDeCombo();
      // Estaba en 9 (10 - 1 reservado): el admin lo pisa a 0.
      await Stock.update(
        { cantidad: 0 },
        { where: { sucursalId: sucursal.id, productoId: combo.id } }
      );

      expect(
        await reservasDeStockVencidas(comboItem(), sucursal.id)
      ).toHaveLength(1);
    });

    test('vence si el admin sube la cantidad (no debe dar falsos positivos)', async () => {
      await pedidoPendienteDeCombo();
      await Stock.update(
        { cantidad: 50 },
        { where: { sucursalId: sucursal.id, productoId: combo.id } }
      );

      expect(await reservasDeStockVencidas(comboItem(), sucursal.id)).toEqual(
        []
      );
    });

    test('si se rompe un componente, la culpa es del combo, no del componente', async () => {
      await pedidoPendienteDeCombo();
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursal.id, productoId: componenteA.id } }
      );

      const vencidas = await reservasDeStockVencidas(comboItem(), sucursal.id);
      expect(vencidas).toEqual([
        { productoId: combo.id, nombre: 'Combo Doble' },
      ]);
      expect(vencidas.map((v) => v.nombre)).not.toContain('Papas');
    });

    test('funciona igual con productos simples', async () => {
      await cargar(simple.id, 5);
      await descontarStock(
        [{ productoId: simple.id, cantidad: 2 }],
        sucursal.id
      );

      expect(
        await reservasDeStockVencidas(
          [{ productoId: simple.id, cantidad: 2 }],
          sucursal.id
        )
      ).toEqual([]);
      await Stock.update(
        { disponible: false },
        { where: { sucursalId: sucursal.id, productoId: simple.id } }
      );
      expect(
        await reservasDeStockVencidas(
          [{ productoId: simple.id, cantidad: 2 }],
          sucursal.id
        )
      ).toEqual([{ productoId: simple.id, nombre: 'Empanada' }]);
    });

    test('sin líneas de catálogo no hay nada que revisar', async () => {
      expect(await reservasDeStockVencidas([], sucursal.id)).toEqual([]);
    });

    test('el mensaje ya no manda al cliente al carrito', () => {
      expect(mensajeDeReservasVencidas([{ nombre: 'Combo Doble' }])).toBe(
        'Ya no se puede preparar el pedido: Combo Doble ya no está disponible en ninguna sucursal.'
      );
      expect(
        mensajeDeReservasVencidas([
          { nombre: 'Empanada' },
          { nombre: 'Combo Doble' },
        ])
      ).toMatch(/Empanada y Combo Doble ya no están disponibles/);
    });
  });
});
