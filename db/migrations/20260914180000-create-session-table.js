'use strict';

// Tabla de sesiones server-side usada por connect-pg-simple (express-session).
// Crearla por migración evita que la tienda necesite ejecutar su bloque de
// creación dinámica (que usa el prefijo `node:` de Node, incompatible con
// el resolver de Jest 26 / Node 14) y deja el esquema declarado en el repo.
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
    `);
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`
    );
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "session";`);
  },
};
