/**
 * Modelo: Sucursal
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - nombre (STRING, NOT NULL)
 *   - direccion (STRING, NOT NULL)
 *   - lat (DECIMAL(10,8), nullable — latitud geográfica)
 *   - lng (DECIMAL(11,8), nullable — longitud geográfica)
 *   - horario (STRING, nullable — ej: "Lun-Dom 10:00-23:00")
 *   - telefono (STRING, nullable)
 *   - estado (STRING, default 'activo' — valores: 'activo' | 'inactivo')
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Una Sucursal tiene muchos Pedidos (hasMany)
 *
 * Referencia: frontend src/services/seedData.js → sucursalesMock
 */
