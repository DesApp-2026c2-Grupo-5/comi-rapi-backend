/**
 * Rutas de autenticación y registro.
 *
 * Endpoints:
 *   POST /api/auth/login     → auth_controller.login (CLIENTE y ADMIN)
 *   POST /api/auth/registro  → auth_controller.registro
 *
 * Body login:   { email, password }
 * Body registro: { nombre, email, password, rol }
 *
 * Respuesta: { success: true, data: { usuario, token } }
 *   o  { success: false, error: string }
 *
 * Ver frontend: src/api/auth.js (loginCliente, loginAdmin, registroCliente, registroAdmin).
 */
