/**
 * Modelo: Categoria
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - nombre (STRING, unique, NOT NULL)
 *   - descripcion (TEXT, nullable)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Una Categoria tiene muchos Productos (hasMany)
 *
 * Referencia: frontend src/services/seedData.js → categoriasMock
 */
