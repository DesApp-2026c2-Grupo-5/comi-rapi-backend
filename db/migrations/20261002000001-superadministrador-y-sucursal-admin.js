'use strict';

// M1: incorpora el rol SUPERADMINISTRADOR y la sucursal de pertenencia del
// ADMINISTRADOR (Usuario.sucursalId).
//
// Es distinta de Pedido.sucursalId: la del pedido se asigna por regla de
// negocio (proximidad + stock). Acá se modela la sucursal asignada al
// administrador para acotar su operación. El CHECK garantiza que solo un
// ADMINISTRADOR pueda tener sucursal (CLIENTE y SUPERADMINISTRADOR la dejan
// en NULL).
//
// PostgreSQL no permite quitar un valor de un ENUM, por lo que down() no
// revierte el valor SUPERADMINISTRADOR.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = '"enum_Usuarios_rol"'::regtype
            AND enumlabel = 'SUPERADMINISTRADOR'
        ) THEN
          ALTER TYPE "enum_Usuarios_rol" ADD VALUE 'SUPERADMINISTRADOR';
        END IF;
      END
      $$;
    `);

    await queryInterface.addColumn('Usuarios', 'sucursalId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: {
        model: 'Sucursales',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "Usuarios" ADD CONSTRAINT "chk_usuarios_sucursal_solo_admin" CHECK ("rol" = 'ADMINISTRADOR' OR "sucursalId" IS NULL)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "Usuarios" DROP CONSTRAINT IF EXISTS "chk_usuarios_sucursal_solo_admin"`
    );
    await queryInterface.removeColumn('Usuarios', 'sucursalId');
  },
};
