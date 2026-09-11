/**
 * Middleware: manejo de errores
 *
 * Objetivo: centralizar el manejo de errores de toda la aplicación.
 *
 * Comportamiento esperado:
 *   - Error de Sequelize (ValidationError, UniqueConstraintError) → 400 { success: false, error: mensaje }
 *   - Error 404 (recurso inexistente) → 404 { success: false, error }
 *   - Cualquier otro error → 500 { success: false, error: 'Error interno del servidor' }
 *
 * Forma de respuesta consistente con el frontend:
 *   { success: false, error: string }
 *
 * Se registra en app.js después de las rutas:
 *   app.use(errorHandler)
 */
