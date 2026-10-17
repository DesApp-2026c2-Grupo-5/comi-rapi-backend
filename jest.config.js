module.exports = {
  // Fija NODE_ENV=test ANTES de que se cargue la config de la app. Sin esto, una
  // corrida sin NODE_ENV (p. ej. desde el runner del editor) apuntaría a la base
  // de DESARROLLO y la truncaría.
  setupFiles: ['./jest.env.js'],
  setupFilesAfterEnv: ['./lib/models/index.js', './jest.setup.js'],
  testEnvironment: 'node',
  // Todas las suites comparten la MISMA base de test y cada una llama a
  // cleanDb() (trunca todas las tablas). Si Jest corre suites en paralelo, se
  // pisan entre sí y aparecen fallos espurios de FKs/datos. Un solo worker
  // garantiza que corran de a una, sin importar cómo se invoque Jest.
  maxWorkers: 1,
  // Con barra al principio y al final a propósito: Jest compara estos patrones
  // contra el path ABSOLUTO del test. Con "./dist" no matchea nunca (delante de
  // "dist" hay una "\"), y entonces corrían también las copias compiladas de los
  // tests dentro de dist/. Esos copias llaman cleanDb(), que trunca todas las
  // tablas, y al hacerlo en medio de otro suite tumbaban sus fixtures:
  // "insert or update on table \"Stocks\" violates foreign key constraint".
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  modulePathIgnorePatterns: ['./docker'],
  testTimeout: 15000,
};
