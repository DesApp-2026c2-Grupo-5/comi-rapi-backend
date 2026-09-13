# AGENTS.md — Comi-Rapi Backend

Instrucciones permanentes para el trabajo de OpenCode sobre este proyecto.

## Fuentes de verdad (en orden de prioridad)

1. `docs/enunciado.md` — consigna funcional del TP.
2. `docs/modelo-dominio.md` — modelo de dominio aprobado.
3. `docs/DER.md` — diagrama entidad-relación / estructura de datos.

`docs/DER-comi-rapi.pdf` es el DER exportado (mismo contenido).
`docs/historico/analisis-inicial.md` es material histórico: NO es fuente de verdad y no debe usarse para redefinir el modelo.

Ante cualquier contradicción entre documentación y código existente, la documentación tiene prioridad. Si existe una contradicción entre documentos, no inventar una solución: señalarla y pedir confirmación antes de modificar el modelo.

## Arquitectura y responsabilidades

Flujo de una petición:
`Routes → Middlewares → Controllers → Services → Models → Database`.

- `lib/routes/` — declara endpoints (método + ruta + middlewares + controller). Sin lógica de negocio.
- `lib/middlewares/` — autenticación/autorización, manejo de errores y validación de entrada.
- `lib/controllers/` — traduce HTTP↔dominio; NO debe contener reglas de negocio.
- `lib/services/` — reglas de negocio (asignación de sucursal, transiciones de estado, stock, promociones).
- `lib/models/` — modelos Sequelize (entidades del DER).
- `lib/config/` — configuración de entorno y Sequelize.

## Convenciones de modelos / migraciones

- Un archivo por entidad del DER (no agrupar entidades en un solo archivo).
- Modelos: clase Sequelize con `init(sequelize)` + `associate(db)`. `lib/models/index.js` los descubre automáticamente.
- Migraciones: en `db/migrations/`; seeders: en `db/seeders/`. Sírvanse de `.sequelizerc`.
- Nombre de tabla en plural (`Productos`, `Categorias`); nombres de columnas según exactamente el DER (ej. `usuarioId`, `latitud`, `longitud`, `horarios`, `activa`, `tipo`).
- Tipos de dato según la columna `Tipo de dato` del DER (INTEGER, STRING, TEXT, DECIMAL(10,2), DECIMAL(10,7), BOOLEAN, DATE, ENUM).
- Respetar PK, FK, UNIQUE y restricciones indicadas en `DER.md`.

## Reglas de alcance

- No inventar entidades, relaciones ni reglas que contradigan el modelo aprobado.
- No implementar todavía entidades de Propuesta 2 (`Repartidor`, `Calificacion`, `Notificacion`, rol `REPARTIDOR`).
- Los snapshots históricos del DER son obligatorios: `Pedido` conserva la dirección (calle, altura, ciudad, codigoPostal, referencia, latitud, longitud); `PedidoItem` conserva `nombreProducto` y `precioUnitario`; `PedidoItemOpcion` conserva `nombre` y `precioAdicional`; `PedidoPromocion` conserva `descuentoAplicado`. Nunca reconstruir histórico desde el catálogo actual.

## Implementación reutilizable existente

- `Categoria` y `Producto` ya tienen implementación funcional (migración + modelo + controller + ruta + seeder). Reutilizarla y adaptarla (por ejemplo, agregar `tipo` en `Producto`), no rehacerla innecesariamente.

## Comandos existentes

- `npm run dev` — build y ejecución en development.
- `npm run build` — transpila con Babel a `dist/`.
- `npm run db:init` — transpila y ejecuta migraciones.
- `npm run db:migrate` — ejecuta migraciones.
- `npm run db:seed` — carga seeders.
- `npm run lint` — eslint + prettier.
- `npm test` / `npm run test:watch` — tests con Jest.