import express from 'express';
import usuarios from './usuarios';

// TODO - Descomentar estos imports y el router.use correspondiente a medida que
// se implementen sus controllers/rutas (actualmente los archivos son solo estructura).
//
// import auth from './auth';
// import categorias from './categorias';
// import productos from './productos';
// import sucursales from './sucursales';
// import pedidos from './pedidos';
// import personalizacion from './personalizacion';
// import direcciones from './direcciones';

const router = express.Router();

router.use('/api/usuarios', usuarios);
// router.use('/api/auth', auth);
// router.use('/api/categorias', categorias);
// router.use('/api/productos', productos);
// router.use('/api/sucursales', sucursales);
// router.use('/api/pedidos', pedidos);
// router.use('/api/personalizacion', personalizacion);
// router.use('/api/direcciones', direcciones);

export default router;
