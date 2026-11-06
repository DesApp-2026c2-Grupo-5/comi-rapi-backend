import express from 'express';
import * as stock from '../controllers/stock_controller';
import {
  acotarASucursalPropia,
  permitirRoles,
  requiereSucursalOperativa,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

/**
 * Stock por sucursal (DER §2.10). Todo es del operador de la sucursal: el
 * stock es de la sucursal y lo define la sucursal. El cliente nunca escribe
 * stock. El ADMINISTRADOR opera su sucursal asignada; el SUPERADMINISTRADOR,
 * la de su contexto (elegido explícitamente). Sin sucursal operativa queda
 * bloqueado; con ella, sólo toca esa sucursal (acotarASucursalPropia).
 */
const operadorDeSucursal = [
  verificarSesion,
  permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursalOperativa,
];

// Máximo de combos que se pueden armar por sucursal con una receta dada.
// Va antes que /:sucursalId/:productoId para que "maximos-de-combos" no se
// lea como un id de sucursal.
router.post(
  '/maximos-de-combos',
  ...operadorDeSucursal,
  withErrorHandling(stock.maximosDeCombos)
);
// Stock de insumos (extras y condimentos). Va antes que /:sucursalId/:productoId
// para que "insumos" no se lea como un id de sucursal.
router.get(
  '/insumos',
  ...operadorDeSucursal,
  withErrorHandling(stock.indexInsumos)
);
router.put(
  '/insumos/:insumoId',
  ...operadorDeSucursal,
  withErrorHandling(stock.updateInsumo)
);
// Stock de ingredientes (materias primas de las recetas). Va antes que
// /:sucursalId/:productoId para que no se lea como un id de sucursal.
router.get(
  '/ingredientes',
  ...operadorDeSucursal,
  withErrorHandling(stock.indexIngredientes)
);
router.put(
  '/ingredientes/:ingredienteId',
  ...operadorDeSucursal,
  withErrorHandling(stock.updateIngrediente)
);
// Máximo de unidades producibles por sucursal para una receta de ingredientes.
router.post(
  '/maximos-de-recetas',
  ...operadorDeSucursal,
  withErrorHandling(stock.maximosDeRecetas)
);
router.get('/', ...operadorDeSucursal, withErrorHandling(stock.index));
router.get(
  '/:sucursalId/:productoId',
  ...operadorDeSucursal,
  acotarASucursalPropia,
  withErrorHandling(stock.show)
);
router.get(
  '/:sucursalId/:productoId/disponibilidad',
  ...operadorDeSucursal,
  acotarASucursalPropia,
  withErrorHandling(stock.disponibilidad)
);
router.post(
  '/:sucursalId/:productoId',
  ...operadorDeSucursal,
  acotarASucursalPropia,
  withErrorHandling(stock.create)
);
router.put(
  '/:sucursalId/:productoId',
  ...operadorDeSucursal,
  acotarASucursalPropia,
  withErrorHandling(stock.update)
);
router.delete(
  '/:sucursalId/:productoId',
  ...operadorDeSucursal,
  acotarASucursalPropia,
  withErrorHandling(stock.destroy)
);

export default router;
