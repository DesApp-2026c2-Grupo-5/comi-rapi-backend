# Informe: parámetros de negocio configurables

## Objetivo

Centralizar los valores que antes estaban hardcodeados en el backend y el
frontend (envío, cobertura, límites de carrito/pedido y promociones) en un
catálogo único, editable solo por el `SUPERADMINISTRADOR`. El backend es la
autoridad; el frontend solo consume los valores para la UI.

## Arquitectura

- **Catálogo cerrado** en `lib/services/parametros_service.js` (`PARAMETROS`):
  define claves, tipo, rango, grupo, unidad, descripción y valor por defecto.
- **Tabla `ParametrosSistema`**: `id` (PK), `clave` (UNIQUE), `valor` y
  `descripcion` (DER §2.20 / modelo-dominio §5.17). Se guarda una fila por clave
  usada; `descripcion` es informativa para el panel. Si no hay fila, se usa el
  valor por defecto del catálogo.
- Cualquier clave fuera del catálogo se rechaza con error (→ HTTP 400): la tabla
  nunca queda con claves "colgadas".

## Parámetros

| Clave                                 | Grupo       | Default | Unidad      |
| ------------------------------------- | ----------- | ------- | ----------- |
| `montoMinimoEnvioGratis`              | envio       | 10000   | $           |
| `costoEnvioFijo`                      | envio       | 350     | $           |
| `radioCoberturaKm`                    | cobertura   | 5       | km          |
| `cantidadMaximaProductoCarrito`       | carrito     | 20      | unidades    |
| `minimoComponentesCombo`              | catalogo    | 2       | productos   |
| `montoMinimoPedido`                   | pedido      | 2000    | $           |
| `montoMaximoPedido`                   | pedido      | 500000  | $           |
| `cantidadMaximaItemsPedido`           | pedido      | 50      | unidades    |
| `cantidadMaximaUnidadesProducto`      | pedido      | 20      | unidades    |
| `porcentajeMaximoDescuento`           | promociones | 50      | %           |
| `cantidadMaximaPromocionesAplicables` | promociones | 3       | promociones |

## Backend

- Modelo, migración y seeder: `ParametroSistema` + `20261007000001-create-…` +
  `20261007000002-parametros-sistema`.
- API: `GET /api/parametros` (público, sin datos sensibles) y
  `PUT /api/superadmin/parametros` (solo `SUPERADMINISTRADOR`; valida el lote
  completo antes de escribir). Endpoints en `lib/routes/parametros.js` y
  `lib/routes/superadmin.js`.
- Integraciones: `cobertura_service` (radio), `combo` (mínimo de componentes),
  `promocion_controller` (porcentaje máximo) y `pedido_controller` (envío
  server-side + `validarLimitesDePedido`: mínimos/máximos de subtotal, ítems y
  unidades).
- El cliente ya no envía `costoEnvio`: se calcula en el backend.

## Frontend

- Capa de datos: `src/api/parametros.js`, `src/context/ParametrosContext.jsx`,
  `src/hooks/useParametros.js` (con `PARAMETROS_POR_DEFECTO` como fallback).
- Consumo: `services/envio.js`, `Carrito`, `ResumenPedido`, `DetallePedido`,
  `ItemCarrito`, `ProductoPersonalizarModal`, `EditarComponentes`,
  `FormularioProducto` y `FormularioPromocion`.
- Administración: página `pages/superadmin/Parametros.jsx` con
  `FormularioParametros.jsx` (agrupa por grupo, valida en espejo, guarda el lote
  completo) + ruta `/superadmin/parametros` y entrada en los menús.

## Seguridad

- `GET` es público (catálogo sin datos sensibles).
- `PUT` exige sesión de `SUPERADMINISTRADOR`; `CLIENTE`/`ADMINISTRADOR` → 403.
- El rol se toma de la sesión, nunca del body.

## Verificación

- Backend: `32 suites / 532 tests` en verde; `npm run lint` OK.
- Frontend: `npm run build` OK; archivos nuevos sin errores de lint (el repo
  arrastra deuda previa en otros archivos).

## Notas

- `cantidadMaximaUnidadesProducto` solapa con `cantidadMaximaProductoCarrito`
  (uno limita el carrito, el otro un pedido).
- `cantidadMaximaPromocionesAplicables` está reservado: el motor actual aplica
  el mejor descuento por línea sin acumular; el parámetro queda documentado.
- Swagger (`docs/swagger.yml`) documenta ambos endpoints y el schema `Parametro`.
- Se eliminó el bloque muerto `config.cobertura` (`COBERTURA_RADIO_MAX_KM`) y su
  variable de entorno en `.env.development`/`.env.test`/`.env.example`: el radio
  de cobertura ahora es el parámetro `radioCoberturaKm`.
- El schema de `ParametrosSistema` quedó alineado al DER (antes usaba `clave`
  como PK, sin `id`/`descripcion`); se actualizaron la migración, el modelo, el
  seeder y los tests, y se re-migraron las bases de desarrollo y test.
