module.exports = {
  setupFilesAfterEnv: ['./lib/models/index.js', './jest.setup.js'],
  testEnvironment: 'node',
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
