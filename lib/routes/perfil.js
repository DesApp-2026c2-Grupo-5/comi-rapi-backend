/**
 * Rutas del perfil del cliente.
 *
 * Accesible únicamente para CLIENTE autenticado. El usuario se resuelve de la
 * sesión (req.usuario.id); nunca se acepta un id/usuarioId del frontend.
 *
 * Endpoints:
 *   GET    /api/perfil                  → datos del perfil autenticado
 *   PUT    /api/perfil                  → edita datos personales
 *   POST   /api/perfil/foto             → sube la foto de perfil (multipart,
 *                                          campo "imagen")
 *   DELETE /api/perfil/foto             → elimina la foto de perfil
 *   POST   /api/perfil/cambiar-password → cambia la contraseña (con la actual,
 *                                          limitado por usuario)
 */
import express from 'express';
import {
  mostrar,
  actualizar,
  cambiarContrasena,
  subirFoto,
  quitarFoto,
} from '../controllers/perfil_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { perfilPasswordLimiter } from '../middlewares/rate_limit';
import { subirImagenUnica } from '../middlewares/upload';

const router = express.Router();

router.use(verificarSesion, permitirRoles('CLIENTE'));

router.get('/', withErrorHandling(mostrar));
router.put('/', withErrorHandling(actualizar));
router.post('/foto', subirImagenUnica(), withErrorHandling(subirFoto));
router.delete('/foto', withErrorHandling(quitarFoto));
router.post(
  '/cambiar-password',
  perfilPasswordLimiter,
  withErrorHandling(cambiarContrasena)
);

export default router;
