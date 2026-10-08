import express from 'express';

import { resumen } from '../controllers/superadmin_controller';
import { actualizar } from '../controllers/parametros_controller';
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

// Edición de los parámetros de negocio: solo el SUPERADMINISTRADOR. La
// lectura del catálogo es pública (ver `routes/parametros.js`).
router.put(
  '/parametros',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  withErrorHandling(actualizar)
);

export default router;
