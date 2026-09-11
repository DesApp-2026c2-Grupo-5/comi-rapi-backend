/**
 * Modelo: Producto
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - nombre (STRING, NOT NULL)
 *   - precio (DECIMAL, NOT NULL)
 *   - imagen (STRING, nullable — URL de imagen)
 *   - descripcion (TEXT, nullable)
 *   - categoriaId (INTEGER, FK → Categorias.id, NOT NULL)
 *   - activo (BOOLEAN, default true — para borrado lógico)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Un Producto pertenece a una Categoria (belongsTo)
 *   - Un Producto tiene muchos PersonalizacionElementos (hasMany)
 *   - Un Producto puede ser referencia de otros PersonalizacionElementos (hasMany como productoReferencia)
 *
 * Referencia: frontend src/services/seedData.js → productosMock
 *   El frontend envía 'categoria' como string (nombre), el backend resuelve por categoriaId.
 */
