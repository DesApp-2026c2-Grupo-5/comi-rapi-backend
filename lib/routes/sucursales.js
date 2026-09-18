/**
 * Rutas de sucursales.
 *
 * Endpoints implementados:
 *   GET    /api/sucursales        → sucursal_controller.index   (público, solo activas;
 *                                                                  ?activa=false solo ADMIN)
 *   GET    /api/sucursales/:id    → sucursal_controller.show    (público, inactivas solo ADMIN)
 *
 * Pendiente de implementar (sprint futuro): ABM de sucursales (ADMIN).
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/sucursales.js.
 */

import express from 'express';
import { index, show } from '../controllers/sucursal_controller';
import { sesionOpcional } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

router.get('/', sesionOpcional, withErrorHandling(index));
router.get('/:id', sesionOpcional, withErrorHandling(show));

export default router;
