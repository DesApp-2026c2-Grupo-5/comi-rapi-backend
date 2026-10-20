import express from 'express';

import { reportes } from '../controllers/reporte_controller';
import {
  permitirRoles,
  requiereSucursal,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Reportes de negocio: el ADMINISTRADOR solo ve su sucursal; el
// SUPERADMINISTRADOR ve todo o filtra por `?sucursalId=`.
router.get(
  '/',
  verificarSesion,
  permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(reportes)
);

export default router;
