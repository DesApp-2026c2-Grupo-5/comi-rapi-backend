import { maximoDeCombosDeReceta } from './stock';

describe('stock (máximo de combos por receta)', () => {
  const recetaSimple = [
    { productoId: 1, cantidad: 1 },
    { productoId: 2, cantidad: 1 },
    { productoId: 3, cantidad: 1 },
  ];

  test('el mínimo de la receta acota el máximo', () => {
    const maximo = maximoDeCombosDeReceta(recetaSimple, {
      1: 10,
      2: 4,
      3: 8,
    });
    expect(maximo).toBe(4);
  });

  test('un componente en cero anula el combo', () => {
    expect(maximoDeCombosDeReceta(recetaSimple, { 1: 10, 2: 0, 3: 8 })).toBe(0);
  });

  test('un componente ausente de la sucursal cuenta como 0', () => {
    expect(maximoDeCombosDeReceta(recetaSimple, { 1: 10, 2: 5 })).toBe(0);
  });

  test('divide por la cantidad que lleva la receta', () => {
    // 2 unidades de papas por combo: con 10 papas salen 5 combos, no 10.
    const receta = [
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 2 },
    ];
    expect(maximoDeCombosDeReceta(receta, { 1: 10, 2: 10 })).toBe(5);
  });

  test('no baja de cero cuando el componente no alcanza para un combo', () => {
    // La receta lleva 3 papas por combo: con 2 papas no sale ni uno.
    const receta = [
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 3 },
    ];
    expect(maximoDeCombosDeReceta(receta, { 1: 10, 2: 2 })).toBe(0);
  });

  test('acepta un Map de cantidades', () => {
    const cantidades = new Map([
      [1, 10],
      [2, 7],
      [3, 3],
    ]);
    expect(maximoDeCombosDeReceta(recetaSimple, cantidades)).toBe(3);
  });

  test('receta vacía da 0 (no Infinity)', () => {
    expect(maximoDeCombosDeReceta([], { 1: 10 })).toBe(0);
    expect(maximoDeCombosDeReceta(null, { 1: 10 })).toBe(0);
  });
});
