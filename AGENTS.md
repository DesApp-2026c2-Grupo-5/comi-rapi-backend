# AGENTS.md — Comi-Rapi Backend

Instrucciones permanentes para el trabajo de OpenCode sobre este proyecto.

## Fuentes de verdad (en orden de prioridad)

1. `docs/enunciado.md` — consigna funcional del TP.
2. `docs/modelo-dominio.md` — modelo de dominio aprobado.
3. `docs/DER.md` — diagrama entidad-relación / estructura de datos.
4. `docs/resenas.md` — reglas, endpoints y datos demo de reseñas.
5. `docs/quejas.md` — reclamos sobre pedidos entregados.
6. `docs/notificaciones.md` — centro de notificaciones persistido del cliente.
7. `docs/insumos.md` — catálogo de extras/condimentos y su stock por sucursal.

Los horarios de atención están en `docs/reglas-negocio.md` §22 (y en `docs/DER.md` §2.3.1 / `docs/modelo-dominio.md` §5.3.1): cualquier cambio de comportamiento debe reflejarse ahí.

`docs/DER-comi-rapi.pdf` es el DER exportado (mismo contenido).
`docs/historico/analisis-inicial.md` es material histórico: NO es fuente de verdad y no debe usarse para redefinir el modelo.

Ante cualquier contradicción entre documentación y código existente, la documentación tiene prioridad. Si existe una contradicción entre documentos, no inventar una solución: señalarla y pedir confirmación antes de modificar el modelo.

## Arquitectura y responsabilidades

Flujo de una petición:
`Routes → Middlewares → Controllers → Services → Models → Database`.

- `lib/routes/` — declara endpoints (método + ruta + middlewares + controller). Sin lógica de negocio.
- `lib/middlewares/` — autenticación/autorización, manejo de errores y validación de entrada.
- `lib/controllers/` — traduce HTTP↔dominio; NO debe contener reglas de negocio.
- `lib/services/` — reglas de negocio (asignación de sucursal, transiciones de estado, stock, promociones, reseñas).
- `lib/models/` — modelos Sequelize (entidades del DER).
- `lib/config/` — configuración de entorno y Sequelize.

## Convenciones de modelos / migraciones

- Un archivo por entidad del DER (no agrupar entidades en un solo archivo).
- Modelos: clase Sequelize con `init(sequelize)` + `associate(db)`. `lib/models/index.js` los descubre automáticamente.
- Migraciones: en `db/migrations/`; seeders: en `db/seeders/`. Sírvanse de `.sequelizerc`.
- Nombre de tabla en plural (`Productos`, `Categorias`, `HorarioSucursales`); nombres de columnas según exactamente el DER (ej. `usuarioId`, `latitud`, `longitud`, `diaSemana`, `apertura`, `cierre`, `activa`, `tipo`).
- Tipos de dato según la columna `Tipo de dato` del DER (INTEGER, STRING, TEXT, DECIMAL(10,2), DECIMAL(10,7), BOOLEAN, DATE, ENUM).
- Respetar PK, FK, UNIQUE y restricciones indicadas en `DER.md`.

## Reglas de alcance

- No inventar entidades, relaciones ni reglas que contradigan el modelo aprobado.
- No implementar todavía las entidades de Propuesta 2 que siguen fuera de alcance (`Repartidor`, rol `REPARTIDOR`). `Resena` **sí** está implementada: reemplaza la "Calificación" de la Propuesta 2 y se limita a producto/combo + estrellas + comentario. `Queja` también está autorizada explícitamente: es el canal de reclamos sobre pedidos entregados. `Notificacion` **también** está autorizada explícitamente: es el centro de notificaciones persistido del CLIENTE y no habilita las entidades restantes de la Propuesta 2.
- Los snapshots históricos del DER son obligatorios: `Pedido` conserva la dirección (calle, altura, ciudad, codigoPostal, referencia, latitud, longitud); `PedidoItem` conserva `nombreProducto` y `precioUnitario`; `PedidoItemOpcion` conserva `nombre` y `precioAdicional`; `PedidoPromocion` conserva `descuentoAplicado`. Nunca reconstruir histórico desde el catálogo actual.

## Implementación reutilizable existente

- `Categoria` y `Producto` ya tienen implementación funcional (migración + modelo + controller + ruta + seeder). Reutilizarla y adaptarla (por ejemplo, agregar `tipo` en `Producto`), no rehacerla innecesariamente.
- **Reseñas**: `Resena` tiene migración, modelo, asociaciones, service (`lib/services/resenas.js`), controller, rutas (`/api/productos/:id/resenas` público y `/api/resenas/*` para CLIENTE) y tests. El detalle está en `docs/resenas.md`. No volver a usar `RESENAS_DEMO` ni promedios hardcodeados en el frontend.
- **Quejas**: `Queja` tiene migración (`20261102000001-create-queja.js`), modelo, asociaciones, service (`lib/services/quejas.js`), controller, rutas (`POST /api/quejas`, `GET /api/quejas/mias`, `POST /api/quejas/:id/mensajes`, `POST /api/quejas/:id/cerrar`, `GET /api/quejas` y `PUT /api/quejas/:id`) y tests. Solo el CLIENTE reclama sobre un pedido propio `entregado` y una vez por pedido; el ADMINISTRADOR gestiona su sucursal y el SUPERADMINISTRADOR todo. El hilo vive en `QuejaMensajes`: el cliente responde hasta 5 veces (reabre a `PENDIENTE` si estaba resuelta/rechazada) y puede cerrar en cualquier momento (`CERRADA`, final). `RESUELTA`/`RECHAZADA` exigen respuesta. El negocio puede sumar mensajes al hilo sin cambiar de estado (`PUT /api/quejas/:id` con `respuesta` y sin `estado`); la bandeja ordena por última actividad (`updatedAt`) y el frontend la muestra como conversaciones. Detalle en `docs/quejas.md`. No hay seeder demo.
- **Notificaciones**: `Notificacion` tiene migración (`20261106000001-create-notificacion.js`), modelo, asociaciones (`Usuario`/`Pedido`/`Queja` `hasMany`), service (`lib/services/notificaciones.js`), controller, rutas (`GET /api/notificaciones`, `GET /api/notificaciones/no-leidas`, `PUT /api/notificaciones/leidas`, `PUT /api/notificaciones/:id/leida`) y tests. Es exclusiva del `CLIENTE`: el negocio conserva sus badges de Pedidos y Reclamos. Los avisos de pedido se crean dentro de la transacción de `cambiarEstado` y se emiten por socket después del commit; el cliente no recibe aviso de su propia cancelación, pero sí de la cancelación automática por cierre de sucursal. Las respuestas y los cambios de estado de una queja también generan avisos. El estado leído (`leida`/`leidaEn`) se persiste por usuario y el listado/contador se calculan siempre en el backend. El canal emite `notificacion_creada` solo a la room privada `usuario:{id}`. Detalle en `docs/notificaciones.md`.
- **Horarios de atención**: `HorarioSucursal` (migración `20261031000001-create-horario-sucursal.js`, modelo `lib/models/horario_sucursal.js`, `Sucursal.hasMany as: 'horarios'`) guarda una fila por día y franja (`diaSemana` 1..7, `apertura`/`cierre` `TIME`). La lógica vive en `lib/services/horarios_service.js` (`franjaVigente`, `agruparHorarios`, `formatearHorarios`, `normalizarHorarios`, `proximaApertura`). `Sucursal.horarios` (texto libre) **ya no existe**: se eliminó tras el backfill. El corte de pedidos se deriva restando el parámetro global `margenCierreMinutos` (default 30); no se persiste. La evaluación se hace en `America/Argentina/Buenos_Aires` con un único `ahora` por request. Los avisos del cliente son `POST /api/pedidos/disponibilidad` y `GET /api/pedidos/:id/disponibilidad`. El canal de tiempo real emite `sucursal_estado` (broadcast) al crear/editar/baja una sucursal, al cambiar `margenCierreMinutos` y desde `lib/services/horarios_vigia.js`, que programa un único temporizador al próximo límite (`proximaLimite`: apertura o corte) de las sucursales activas; se arranca en `bin/www.js`. Al confirmar el pago con la sucursal cerrada y sin alternativa, el pedido se **cancela automáticamente** (repone stock, historial) y la respuesta 409 trae `cancelado: true`.
- **Datos demo**: el seeder `20261025000002-demo-clientes-compras.js` crea 43 clientes demo (`sunny@demo.com`, `nephis@demo.com`, ... `altelicia@demo.com`; password `123456`) con compras en volumen y entre 5 y 9 reseñas por producto, de clientes distintos; el seeder `20261025000003-stock-150.js` deja todo el stock en 150. Ambos son idempotentes y están documentados en `docs/resenas.md` §5.

## Comandos existentes

- `npm run dev` — build y ejecución en development.
- `npm run build` — transpila con Babel a `dist/`.
- `npm run db:init` — transpila y ejecuta migraciones.
- `npm run db:migrate` — ejecuta migraciones.
- `npm run db:seed` — carga seeders.
- `npm run lint` — eslint + prettier.
- `npm test` / `npm run test:watch` — tests con Jest sobre `SQL_TEST_DATABASE` (nunca la base de desarrollo). Ambos corren `--runInBand`: no lanzar dos runners en paralelo sobre la misma base de test (truncan tablas y producen deadlocks). Una base separada por runner se consigue con `SQL_TEST_DATABASE=...`. Las migraciones de la base de test se aplican con `NODE_ENV=test npx sequelize db:migrate` (`.sequelizerc` apunta a `dist/`, así que requiere `npm run build` antes).
- `npm run test:tiempo-real` — verificación end-to-end del canal WebSocket contra el backend de desarrollo (debe estar levantado en `:3000`). Al terminar borra los pedidos que creó.
- `npm run limpiar:pruebas` — borra los pedidos de los usuarios de prueba (`@test.com`, menos los de la seeder). No toca las cuentas demo `@demo.com` ni sus reseñas. Acepta `--dry-run`.
