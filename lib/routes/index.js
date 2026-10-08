import express from 'express';
import auth from './auth';
import usuarios from './usuarios';
import categorias from './categorias';
import productos from './productos';
import pedidos from './pedidos';
import sucursales from './sucursales';
import direcciones from './direcciones';
import promociones from './promociones';
import parametros from './parametros';
import stock from './stock';
import imagenes from './imagenes';
import perfil from './perfil';
import geo from './geo';
import superadmin from './superadmin';
import docs from './docs';

const router = express.Router();

// Endpoint de salud: no toca la base de datos, sirve de "conexión mínima"
// para que el frontend verifique que la API está arriba.
router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    servicio: 'comi-rapi-backend',
    timestamp: new Date().toISOString(),
  });
});

router.use('/api/auth', auth);
router.use('/api/usuarios', usuarios);
router.use('/api/categorias', categorias);
router.use('/api/productos', productos);
router.use('/api/pedidos', pedidos);
router.use('/api/sucursales', sucursales);
router.use('/api/direcciones', direcciones);
router.use('/api/promociones', promociones);
router.use('/api/parametros', parametros);
router.use('/api/stock', stock);
router.use('/api/imagenes', imagenes);
router.use('/api/perfil', perfil);
router.use('/api/geo', geo);
router.use('/api/superadmin', superadmin);
router.use('/api/docs', docs);

export default router;
