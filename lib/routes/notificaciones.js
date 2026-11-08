import express from 'express';
import {
  index,
  leida,
  leidas,
  noLeidas,
} from '../controllers/notificacion_controller';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// El centro de notificaciones es exclusivo del CLIENTE. El negocio sigue usando
// los contadores de Pedidos y Reclamos, que ya tienen su propio alcance.
router.use(verificarSesion, permitirRoles('CLIENTE'));

router.get('/', withErrorHandling(index));
router.get('/no-leidas', withErrorHandling(noLeidas));
// Va antes de `/:id/leida`: si no, "leidas" se resolvería como un id.
router.put('/leidas', withErrorHandling(leidas));
router.put('/:id/leida', withErrorHandling(leida));

export default router;
