/**
 * Controller: auth_controller
 *
 * Maneja autenticación y registro de usuarios.
 *
 * Funciones esperadas:
 *   - login(req, res):
 *       - POST /api/auth/login
 *       - Body: { email, password }
 *       - Valida credenciales contra el modelo Usuario (email + password con hash).
 *       - Respuesta éxito: { success: true, data: { usuario, token } }
 *           usuario: { id, nombre, email, rol } (sin password).
 *       - Credenciales inválidas: 401 { success: false, error: 'Credenciales incorrectas' }.
 *
 *   - registro(req, res):
 *       - POST /api/auth/registro
 *       - Body: { nombre, email, password, rol }  (rol: 'CLIENTE' | 'ADMIN')
 *       - Verifica que el email no exista → 400 'El email ya está registrado'.
 *       - Hashea el password antes de guardar.
 *       - Respuesta: { success: true, data: { usuario, token } } (201).
 *
 * Notas:
 *   - El frontend distingue loginCliente / loginAdmin pero ambos llaman a POST /api/auth/login
 *     validando el rol al loguear (frontend src/api/auth.js).
 *   - Seed data esperado: cliente@test.com / 123456 (CLIENTE), admin@test.com / 123456 (ADMIN).
 */
