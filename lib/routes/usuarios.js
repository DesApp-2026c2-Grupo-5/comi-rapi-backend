import express from 'express';

import {
  create,
  index,
  masComprados,
  resumen,
  show,
  update,
} from '../controllers/usuario_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

// Listar usuarios: lo ve el ADMIN (para gestionar clientes) y el SUPERADMIN.
// Crear/editar usuarios, roles y sucursal: solo el SUPERADMIN.
const listar = permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR');
const gestionar = permitirRoles('SUPERADMINISTRADOR');

router.get('/', verificarSesion, listar, withErrorHandling(index));
router.get('/:id', verificarSesion, listar, withErrorHandling(show));
// Ficha del cliente en una sola llamada (datos + direcciones + últimos pedidos
// + ranking). Mismo alcance que `show`/`mas-comprados`.
router.get('/:id/resumen', verificarSesion, listar, withErrorHandling(resumen));
// Qué compró el cliente (productos y categorías más pedidos). El alcance por
// sucursal lo decide el controller, igual que en `show`.
router.get(
  '/:id/mas-comprados',
  verificarSesion,
  listar,
  withErrorHandling(masComprados)
);
router.post('/', verificarSesion, gestionar, withErrorHandling(create));
router.put('/:id', verificarSesion, gestionar, withErrorHandling(update));

export default router;
