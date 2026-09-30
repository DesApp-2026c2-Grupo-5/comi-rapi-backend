'use strict';

// Corrige el CHECK de `ComboComponentes.cantidad`.
//
// La migración original lo dejó en `>= 0`, pero el dominio no tiene un caso
// válido con cero: `ComboComponente` responde "¿cuántas unidades de este
// producto lleva UNA unidad del combo?", y una línea con `cantidad = 0` no
// aporta nada a la receta. El modelo (`lib/models/combo_componente.js`) valida
// `min: 1` y `lib/services/combo.js` exige entero positivo, así que la base
// quedaba más laxa que la aplicación y podía dejar pasar filas que el resto
// del sistema no sabe leer (y que rompen el cálculo de máximo de combos al
// dividir por cero en `maximoDeCombosDeReceta`).
//
// Va en una migración aparte a propósito: la original ya corrió en las bases de
// desarrollo y test, así que editar el archivo no cambiaría nada ahí.

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "ComboComponentes" DROP CONSTRAINT IF EXISTS "CK_ComboComponentes_cantidad"`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "ComboComponentes" ADD CONSTRAINT "CK_ComboComponentes_cantidad" CHECK ("cantidad" >= 1)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "ComboComponentes" DROP CONSTRAINT IF EXISTS "CK_ComboComponentes_cantidad"`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "ComboComponentes" ADD CONSTRAINT "CK_ComboComponentes_cantidad" CHECK ("cantidad" >= 0)`
    );
  },
};
