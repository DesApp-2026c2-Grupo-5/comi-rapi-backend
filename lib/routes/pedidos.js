import express from 'express';
import {
  cambiarEstado,
  create,
  index,
  reasignarSucursal,
  show,
  sucursalesCandidatas,
} from '../controllers/pedido_controller';
import {
  permitirRoles,
  requiereSucursal,
  requiereSucursalOperativa,
  verificarSesion,
} from '../middlewares/auth';
import { withErrorHandling } from './utils';

const router = express.Router();

// Repetir pedido (80): reutiliza POST /pedidos, sin endpoint dedicado.
// El frontend rearma { productos: [{ productoId, cantidad, personalizacion }], direccionEntrega }
// desde un pedido propio en estado final (entregado/cancelado) y crea un pedido nuevo en pendiente.
// La propiedad se garantiza con show/index (403 si no es dueño); el total se recalcula en create.
// Un ADMINISTRADOR sin sucursal no puede operar pedidos (requiereSucursal).
// La lectura (index/show) alcanza al SUPERADMINISTRADOR para ver el detalle de un cliente.
router.post(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(create)
);
router.get(
  '/',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(index)
);
router.get(
  '/:id',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(show)
);
router.patch(
  '/:id/estado',
  verificarSesion,
  permitirRoles('CLIENTE', 'ADMINISTRADOR'),
  requiereSucursal,
  withErrorHandling(cambiarEstado)
);
// Reasignación manual: exclusiva del SUPERADMINISTRADOR con contexto de
// sucursal. El ADMINISTRADOR de sucursal ya no reasigna manualmente: la
// excepción operativa queda centralizada en el superadmin, que solo opera
// pedidos de la sucursal de su contexto (el controller lo verifica) y el
// destino se valida con las mismas reglas de cobertura + stock del service.
router.patch(
  '/:id/sucursal',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  requiereSucursalOperativa,
  withErrorHandling(reasignarSucursal)
);

// Candidatas de reasignación de un pedido: sucursales activas dentro de la
// cobertura de la dirección del pedido y con stock suficiente, excluyendo la
// actual. Alimenta el selector del panel; el PATCH re-valida todo (esta lista
// nunca reemplaza a las reglas del service).
router.get(
  '/:id/sucursales-candidatas',
  verificarSesion,
  permitirRoles('SUPERADMINISTRADOR'),
  requiereSucursalOperativa,
  withErrorHandling(sucursalesCandidatas)
);

export default router;
