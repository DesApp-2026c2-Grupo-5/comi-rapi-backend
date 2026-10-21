# Comi-Rapi — Backend

API de Comi-Rapi, una aplicación de delivery de comida con tres roles: cliente, administrador de sucursal y superadministrador. Expone el catálogo, los pedidos, el stock, las sucursales, los reportes y el canal de tiempo real que usa el frontend.

## Tecnologías

- Node.js 14
- Express
- Sequelize
- PostgreSQL
- Socket.IO
- Express Session y CSRF
- Argon2
- Multer
- Nodemailer
- Swagger
- Jest y Supertest

## Instalación

Requiere Node.js 14 y Docker Desktop en ejecución. Los repositorios `comi-rapi-backend` y `comi-rapi-fronted` tienen que quedar en carpetas hermanas, porque el backend guarda las imágenes en `../comi-rapi-fronted/public/imagenes`.

```shell
npm install

docker compose up -d

npm run db:init
NODE_ENV=test npm run db:init
npm run db:seed
npm run crear:superadmin

npm run dev
```

`docker compose up -d` levanta PostgreSQL en el puerto 5432, con las bases de desarrollo y de pruebas, y Mailpit en el puerto 1025, con interfaz web en 8025.

La API queda disponible en `http://localhost:3000` y la documentación de los endpoints en `http://localhost:3000/api/docs`.

## Servicios externos

Para calcular la distancia entre la sucursal y el domicilio del cliente hace falta una clave gratuita de OpenRouteService. Se obtiene registrando una cuenta en [account.heigit.org/signup](https://account.heigit.org/signup) y copiando la API key del panel a un archivo `.env.local` en la raíz de este repositorio:

```
ORS_API_KEY=tu-clave
```

Sin esa clave el cálculo de rutas responde 503 y el flujo de pedidos no arranca. Los demás servicios externos no necesitan nada: la geocodificación de direcciones usa la API pública de datos.gob.ar y el correo de recuperación se envía a Mailpit, que ya levanta Docker.

El detalle de cada servicio está en `docs/servicios-externos.md`.
