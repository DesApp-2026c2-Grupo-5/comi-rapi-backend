import express from 'express';
import {
  activar,
  crearEmision,
  index,
  listarEmisionesCtrl,
  mios,
  obtenerCuponesEmisionCtrl,
  obtenerEmisionCtrl,
  preview,
  reenviarEmisionCtrl,
  show,
} from '../controllers/cupon_controller';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// "Mis cupones" es exclusiva del CLIENTE autenticado: se consulta antes del
// middleware de superadmin para no requerir ese rol.
router.get(
  '/mios',
  verificarSesion,
  permitirRoles('CLIENTE'),
  withErrorHandling(mios)
);

// Gestión de cupones y emisiones: exclusiva del SUPERADMINISTRADOR.
router.use(verificarSesion, permitirRoles('SUPERADMINISTRADOR'));

// Listado y detalle de cupones emitidos.
router.get('/', withErrorHandling(index));
router.patch('/:id/activo', withErrorHandling(activar));

// Preview y emisión de cupones (reemplaza a campañas).
router.post('/preview', withErrorHandling(preview));
router.post('/emisiones', withErrorHandling(crearEmision));
router.get('/emisiones', withErrorHandling(listarEmisionesCtrl));
router.get('/cuponesEmiciones', withErrorHandling(listarEmisionesCtrl));
// Ruta más específica primero: el detalle de cupones no debe ser capturado
// por `/emisiones/:id`.
router.get(
  '/emisiones/:id/cupones',
  withErrorHandling(obtenerCuponesEmisionCtrl)
);
router.get('/emisiones/:id', withErrorHandling(obtenerEmisionCtrl));
router.post('/emisiones/:id/reenviar', withErrorHandling(reenviarEmisionCtrl));

// Detalle de un cupón individual (debe ir después de las rutas estáticas de emisiones).
router.get('/:id', withErrorHandling(show));

export default router;
