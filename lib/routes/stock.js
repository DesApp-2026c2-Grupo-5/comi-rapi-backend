import express from 'express';
import * as stock from '../controllers/stock_controller';
import { permitirRoles, verificarSesion } from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

/**
 * Stock por sucursal (DER §2.10). Todo es del admin: el stock es de la sucursal
 * y lo define la sucursal. El cliente nunca escribe stock.
 */
const soloAdmin = [verificarSesion, permitirRoles('ADMINISTRADOR')];

// Máximo de combos que se pueden armar por sucursal con una receta dada.
// Va antes que /:sucursalId/:productoId para que "maximos-de-combos" no se
// lea como un id de sucursal.
router.post(
  '/maximos-de-combos',
  ...soloAdmin,
  withErrorHandling(stock.maximosDeCombos)
);
router.get('/', ...soloAdmin, withErrorHandling(stock.index));
router.get(
  '/:sucursalId/:productoId',
  ...soloAdmin,
  withErrorHandling(stock.show)
);
router.get(
  '/:sucursalId/:productoId/disponibilidad',
  ...soloAdmin,
  withErrorHandling(stock.disponibilidad)
);
router.post(
  '/:sucursalId/:productoId',
  ...soloAdmin,
  withErrorHandling(stock.create)
);
router.put(
  '/:sucursalId/:productoId',
  ...soloAdmin,
  withErrorHandling(stock.update)
);
router.delete(
  '/:sucursalId/:productoId',
  ...soloAdmin,
  withErrorHandling(stock.destroy)
);

export default router;
