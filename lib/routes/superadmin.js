import express from 'express';

import { resumen } from '../controllers/superadmin_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

// Panel del SUPERADMINISTRADOR: solo él ve los agregados globales (métricas).
router.get(
  '/resumen',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(resumen)
);

export default router;
