/**
 * Modelo: Direccion
 *
 * Direcciones de entrega de los clientes (texto plano, sin coordenadas).
 * La eliminación es lógica: se cambia estado a 'inactivo'.
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - clienteId (INTEGER, FK → Usuarios.id, NOT NULL)
 *   - nombre (STRING, NOT NULL — alias: "Casa", "Trabajo", etc.)
 *   - direccion (STRING, NOT NULL — dirección textual completa)
 *   - ciudad (STRING, nullable)
 *   - codigoPostal (STRING, nullable)
 *   - referencia (STRING, nullable — indicaciones adicionales)
 *   - esPrincipal (BOOLEAN, default false — solo una por cliente)
 *   - estado (STRING, default 'activo' — valores: 'activo' | 'inactivo')
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Una Direccion pertenece a un Usuario (belongsTo, alias: cliente)
 *
 * Regla de negocio:
 *   - Solo puede haber UNA dirección principal activa por cliente.
 *   - Al marcar una como principal, las demás del mismo cliente se desmarcan.
 *
 * Referencia: frontend src/services/seedData.js → direccionesMock
 *   Frontend context: DireccionContext.jsx → CRUD completo
 */
