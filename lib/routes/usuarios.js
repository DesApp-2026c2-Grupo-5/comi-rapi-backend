import express from 'express';

import { create, index, show, update } from '../controllers/usuario_controller';
import { withErrorHandling } from './utils';
import { permitirRoles, verificarSesion } from '../middlewares/auth';

const router = express.Router();

// Listar usuarios: lo ve el ADMIN (para gestionar clientes) y el SUPERADMIN.
// Crear/editar usuarios, roles y sucursal: solo el SUPERADMIN.
const listar = permitirRoles('ADMINISTRADOR', 'SUPERADMINISTRADOR');
const gestionar = permitirRoles('SUPERADMINISTRADOR');

router.get('/', verificarSesion, listar, withErrorHandling(index));
router.get('/:id', verificarSesion, listar, withErrorHandling(show));
router.post('/', verificarSesion, gestionar, withErrorHandling(create));
router.put('/:id', verificarSesion, gestionar, withErrorHandling(update));

export default router;
