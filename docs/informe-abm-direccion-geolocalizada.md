# Informe — Integración del ABM de Dirección con geolocalización y cobertura (Tarea 6)

Documento que describe lo efectivamente implementado en la tarea de integración del ABM de `Direccion` con la geolocalización y la cobertura. Fuente de verdad vigente: `docs/reglas-negocio.md` (§7, §14, §15, §16 y §17), `docs/modelo-dominio.md`, `docs/estructura-backend.md` y los informes previos (`informe-georef.md`, `informe-ors.md`, `informe-cobertura-geografica.md`).

## 1. Objetivo

Integrar la geolocalización y la cobertura al **ABM de Dirección** (usuario y sucursal), de manera que las direcciones reales pasen por las reglas implementadas en las tareas anteriores:

```
ABM Dirección
     ↓
Validación de datos            (direccion_service)
     ↓
Georef                         (geolocation_service → latitud/longitud)
     ↓
Validación de zona             (cobertura_service, configurable)
     ↓
Cobertura respecto de sucursales activas   (distancia real por ruta, ORS)
     ↓
Persistencia de la dirección   (con coordenadas; transacciones en sucursal)
```

El frontend no se comunica con Georef ni con OpenRouteService y no solicita ni envía latitud/longitud manualmente (los payloads ya estaban alineados).

## 2. Flujo implementado

### 2.1 Dirección de usuario (entrega) — `POST /api/direcciones` y `PUT /api/direcciones/:id`

1. **Validación de datos** (en `direccion_service`): calle, altura (entero ≥ 0), provincia, localidad y codigoPostal obligatorios; `latitud`/`longitud` manuales rechazadas (400).
2. **Geocodificación** con `geolocation_service` (Georef): los errores tipados se propagan.
3. **Validación de cobertura** con `cobertura_service.validarCoberturaParaDelivery` (reutilizando la geocodificación ya obtenida, **sin segunda llamada a Georef**): zona de operación + al menos una sucursal activa dentro del radio máximo por ruta.
4. **Persistencia solo si supera todo**: `Direccion.create/update` con `latitud`/`longitud` obtenidas por el backend.

En **actualización**:

- Detección de **cambios reales** contra la BD (normalizando `altura`).
- `CAMPOS_UBICACION` (`calle`, `altura`, `provincia`, `localidad`): si cambió alguno → re-geocodifica + re-valida cobertura; si la re-validación falla → 422 y **no se actualiza nada**.
- Cambios solo en `alias`/`referencia` (o payload idéntico) → actualiza **sin llamar a proveedores**.
- `codigoPostal` **no** re-geocodifica: Georef no lo usa en la query, por lo que no afecta la ubicación obtenida (decisión documentada).

### 2.2 Dirección de sucursal (origen) — `POST/PUT /api/sucursales/:id` (dirección anidada)

- **Geocodificación obligatoria**: una sucursal sin coordenadas no puede ser utilizada por `CoberturaService`. Si Georef falla → 422 y **no se persiste nada** (ni la sucursal ni su dirección).
- **Sin validación de zona/cobertura** (decisión aprobada): la zona de operación es una regla para direcciones de entrega; la sucursal es el origen del delivery.
- **Transacciones**: la llamada externa a Georef ocurre **antes** de iniciar la transacción (`prepararDireccion`); toda la persistencia (sucursal + dirección) se realiza **dentro de la misma transacción** (`persistirDireccionSucursal` con `transaction: t`): si falla cualquier operación, rollback y no queda nada parcial.
- En **update**: detección de cambios reales contra la dirección persistida. Como `FormularioSucursal` reenvía siempre el objeto `direccion` completo, si es idéntico al persistido **no re-geocodifica** (evita llamadas a Georef en cada guardado); si cambió un campo de ubicación, re-geocodifica y actualiza coordenadas.

## 3. Decisiones tomadas

| Decisión                                                                                                                        | Justificación                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuevo `lib/services/direccion_service.js` como orquestación del ABM                                                             | Reglas de negocio en Services (arquitectura del proyecto); controllers delgados                                                                                            |
| `validarDatosDireccion` movida de los controllers al service, con error tipado `ErrorValidacionDireccion` → HTTP 400            | Mantiene el mensaje exacto de los campos y centraliza el mapeo en el error handler                                                                                         |
| Refactor de `cobertura_service`: extracción de `evaluarCoberturaCoordenadas` + `validarCoberturaParaDelivery`                   | Reutiliza coordenadas ya geocodificadas (una sola llamada a Georef por guardado); `validarCoberturaDireccion` queda como wrapper → comportamiento y tests previos intactos |
| Errores tipados nuevos `DireccionFueraDeZonaError` / `DireccionSinCoberturaError` en `cobertura_service`                        | El ABM necesita errores lanzables; la variante de resultado detallado se mantiene para reutilización futura (validación del pedido)                                        |
| Mapeo de errores a HTTP en `error_handler.js` (centralizado)                                                                    | Los controllers no capturan errores; los detalles técnicos del proveedor quedan fuera de la respuesta pública                                                              |
| 422 para fallos semánticos, 503 para infraestructura (decisión aprobada, ajuste del plan: credenciales inválidas → 503, no 500) | Nunca se convierte una caída del proveedor en 422                                                                                                                          |
| `codigoPostal` no dispara re-geocodificación                                                                                    | Georef no lo usa en la query de `direcciones`                                                                                                                              |
| Mensajes amigables para no encontrada/ambigua                                                                                   | No se exponen los mensajes crudos de Georef ("...en Georef Argentina") ni los resultados detallados                                                                        |
| Frontend mínimo (decisión aprobada): mostrar el mensaje real del backend                                                        | Los payloads ya estaban alineados con el flujo; solo faltaba exponer el motivo de rechazo al usuario                                                                       |

## 4. Archivos creados/modificados

| Archivo                                                                 | Acción     | Contenido                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/services/direccion_service.js`                                     | Creado     | Orquestación del ABM: `ErrorValidacionDireccion`, `CAMPOS_UBICACION`, `validarDatosDireccion`, `prepararDireccion`, `crearDireccionDeUsuario`, `actualizarDireccionDeUsuario`, `persistirDireccionSucursal` |
| `lib/services/direccion_service.test.js`                                | Creado     | 21 tests unitarios con mocks                                                                                                                                                                                |
| `lib/services/cobertura_service.js`                                     | Modificado | `evaluarCoberturaCoordenadas` + `validarCoberturaParaDelivery` + errores `DireccionFueraDeZonaError`/`DireccionSinCoberturaError`                                                                           |
| `lib/services/cobertura_service.test.js`                                | Modificado | 3 tests nuevos (21 en total): errores tipados del ABM                                                                                                                                                       |
| `lib/controllers/direccion_controller.js`                               | Modificado | `create`/`update` delegan en `direccion_service`; controllers delgados (validaciones movidas)                                                                                                               |
| `lib/controllers/sucursal_controller.js`                                | Modificado | Dirección anidada delega en `direccion_service`: `prepararDireccion` antes de la transacción, `persistirDireccionSucursal` dentro                                                                           |
| `lib/controllers/direccion_controller.test.js`                          | Modificado | Mock de `node-fetch` + 9 tests nuevos (22 en total)                                                                                                                                                         |
| `lib/controllers/sucursal_controller.test.js`                           | Modificado | Mock de `node-fetch` + 4 tests nuevos (17 en total)                                                                                                                                                         |
| `lib/middlewares/error_handler.js`                                      | Modificado | Mapeo de errores tipados → HTTP (400/422/503)                                                                                                                                                               |
| `docs/swagger.yml`                                                      | Modificado | 422/503 en `/direcciones`, `/direcciones/{id}`, `/sucursales`, `/sucursales/{id}`                                                                                                                           |
| `docs/reglas-negocio.md`                                                | Modificado | §7 actualizada + nueva §17 "ABM de Direccion integrado"; §16 (API/alcance) actualizada                                                                                                                      |
| `docs/modelo-dominio.md`                                                | Modificado | §5.2 y §7.2: la integración con el ABM ya no es tarea posterior                                                                                                                                             |
| `docs/estructura-backend.md`                                            | Modificado | `direccion_service` documentado                                                                                                                                                                             |
| Frontend: `src/context/DireccionContext.jsx`                            | Modificado | `agregarDireccion`/`editarDireccion` devuelven `{ ok, data?, error? }`                                                                                                                                      |
| Frontend: `src/context/SucursalContext.jsx`                             | Modificado | `agregarSucursal`/`actualizarSucursal` devuelven `{ ok, data?, error? }`                                                                                                                                    |
| Frontend: `src/pages/cliente/MisDirecciones.jsx`                        | Modificado | Toast con el motivo real del rechazo (geolocalización/cobertura)                                                                                                                                            |
| Frontend: `src/pages/admin/EditarSucursal.jsx`                          | Modificado | Alert con el motivo real del rechazo                                                                                                                                                                        |
| Frontend: `docs/informe-abm-direccion-geolocalizada.md` (en el backend) | Creado     | Este informe                                                                                                                                                                                                |

No se modificaron: modelos, migraciones, seeders, routes (permisos sin cambios), `geolocation_service`, `routing_service`, config ni `.env`. **Sin commits ni push** (a revisión del equipo).

## 5. Integración Georef / Cobertura / ORS

- **Georef** (`geolocation_service`): invocado desde `direccion_service.prepararDireccion` (una sola vez por guardado que requiera geocodificación). La dirección de entrega y la de sucursal usan el mismo servicio.
- **Cobertura** (`cobertura_service`): `validarCoberturaParaDelivery({ coordenadas, normalizada })` para direcciones de usuario, reutilizando las coordenadas ya obtenidas. La lista de sucursales activas la obtiene de la BD (`obtenerSucursalesActivas`).
- **ORS** (`routing_service`): invocado por `cobertura_service` para la distancia real por ruta entre cada sucursal activa y la dirección de entrega. Nunca se llama a ORS para direcciones de sucursal ni para cambios que no afecten la ubicación.
- **El frontend nunca llama a Georef/ORS** ni envía/recibe latitud/longitud para su ingreso: las coordenadas llegan ya calculadas en las respuestas del backend.

## 6. Tests ejecutados

**Unitarios** (`direccion_service.test.js`, modelos y servicios mockeados — sin APIs externas ni BD):

- `validarDatosDireccion`: validación/normalización en creación, rechazo de campos faltantes, altura inválida, coordenadas manuales, modo parcial.
- `prepararDireccion`: geocodifica siempre al crear; con existente re-geocodifica solo si cambió un campo de ubicación (con datos combinados); cambios solo en `alias`/`referencia` o `codigoPostal` → sin geocodificación; misma altura en otro formato → sin re-geocodificación; `exigirCobertura` valida cobertura con las coordenadas geocodificadas y propaga errores tipados.
- `crearDireccionDeUsuario` / `actualizarDireccionDeUsuario`: persisten coordenadas; no persisten/actualizan nada si la cobertura o la geocodificación fallan.
- `persistirDireccionSucursal`: update dentro de la transacción; conserva coordenadas cuando no hay re-geocodificación; create con `sucursalId` + `activa`.

**Integración** (BD real + `node-fetch` mockeado, patrón existente con `supertest`):

- `direccion_controller.test.js` (22): POST geocodificado con `latitud/longitud` persistidas y verificación del conteo de llamadas (1 Georef + 1 ORS); no encontrada → 422 sin persistir; ambigua → 422; fuera de zona → 422; sin cobertura → 422; validaciones 400 existentes (sin llamadas a proveedores); PUT re-geocodifica y actualiza coords; PUT solo `alias`/`referencia` → sin llamadas; PUT solo `codigoPostal` → sin re-geocodificar; PUT con cobertura fallando → 422 sin actualizar nada; permisos 401/403.
- `sucursal_controller.test.js` (17): POST con dirección geocodificada (coords persistidas, sin llamadas a ORS); geocodificación fallando → 422 sin persistir nada (rollback); PUT re-geocodifica; PUT solo teléfono → sin geocodificación; PUT dirección idéntica → sin re-geocodificar (conserva coords); validaciones 400; permisos.

**Regresión**: `npm test` → **201/201 tests pasan (15 suites)**, incluidos los 21 de `cobertura_service`, los 21 de `direccion_service`, y los tests de Georef/ORS, pedidos, promociones, usuarios y modelos de las tareas anteriores.

**Frontend**: sin framework de tests configurado → verificación manual pendiente (`npm run dev` en ambos repos).

## 7. Problemas encontrados

- **Bug de scope (detectado y corregido con test)**: en el primer intento del update de sucursal, la dirección existente se declaraba dentro del bloque `if` pero se usaba en el callback de la transacción (fuera de ese bloque) → `ReferenceError`. Corregido declarando `let existenteDireccion = null` al inicio del handler.
- **Bug de update vs create (detectado y corregido con test)**: en el update de sucursal no se pasaba `existente` a `persistirDireccionSucursal`, lo que creaba una fila nueva de `Direccion` en lugar de actualizar la existente (la respuesta mostraba la dirección vieja por el `include` 1:1). Corregido pasando la dirección existente dentro de la transacción.
- Se corrigió también que `alias`/`referencia` se recorten en el service (el controller viejo no los recortaba; el frontend ya los recortaba antes de enviar).
- Nota previa vigente: la BD de test requería las migraciones de promociones traídas del merge de `dev` (ya aplicadas en la tarea anterior).

## 8. Puntos pendientes (tareas posteriores)

- Consumo de la validación de cobertura en el flujo del **pedido** (validación al confirmar, endpoints/frontend).
- ETA, asignación de sucursal por stock, pagos reales.
- Backfill opcional: direcciones de usuario persistidas antes de esta tarea no tienen coordenadas (las obtendrán al editar sus campos de ubicación); podría evaluarse un script de backfill.
- Verificación en vivo contra Georef/ORS con direcciones reales y ORS key del `.env.local`.
- Verificación manual del frontend (`MisDirecciones`, `EditarSucursal`) con el backend corriendo.
