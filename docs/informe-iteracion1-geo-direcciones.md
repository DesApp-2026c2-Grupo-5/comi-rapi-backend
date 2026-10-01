# Informe — Iteración 1-geo: modelo territorial y nuevo flujo de direcciones

Documento que describe lo efectivamente implementado en la iteración 1 de la mejora de Direcciones y Geolocalización (diseño aprobado en el plan de la misma iteración). Fuentes: `docs/reglas-negocio.md` (§7, §14, §16, §17, §18), `docs/DER.md`, `docs/modelo-dominio.md`.

## 1. Objetivo

Alinear `Direccion` y el flujo de ingreso de direcciones con el modelo territorial real de Georef Argentina, verificado contra su API en vivo:

1. **Partido/comuna** como unidad intermedia (`departamento` en Georef) para desambiguar direcciones (caso real: "General Villegas 5329" existe en Avellaneda y en Tres de Febrero).
2. **Dejar de pedir al usuario datos que el backend puede obtener**: localidad (la determina Georef) y código postal (**Georef no lo provee** — verificado: no existe en ninguna respuesta ni endpoint; se elimina del formulario en lugar de incorporar otro proveedor).
3. **Desambiguación interactiva**: en lugar del rechazo seco "Dirección ambigua", responder **409 con opciones** para que el usuario elija la ubicación correcta y reintente.

## 2. Hechos verificados contra Georef (doc oficial + API en vivo)

| Hecho                                                                                                                                                                          | Consecuencia en el diseño                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/api/direcciones` acepta `provincia`, `departamento`, `localidad_censal` y/o `localidad` como filtros; **no** acepta `municipio` (HTTP 400)                                   | Se usa `departamento` como filtro de desambiguación                                                                  |
| En Buenos Aires el `departamento` **es** el partido; en CABA los `departamentos` son las **15 comunas** (Res. INDEC 55/2019); en CABA los `municipios` también son las comunas | Un único campo `departamento` en `Direccion`: partido (PBA) / comuna (CABA). Sin campos separados `partido`/`comuna` |
| En CABA la única `localidad_censal` es "Ciudad Autónoma de Buenos Aires"; **no existe endpoint de barrios**                                                                    | En CABA la localidad no aporta valor discriminante; el usuario nunca ingresa comuna ni localidad                     |
| La respuesta de `/direcciones` (campos=completo) **no incluye código postal**; no hay endpoint de CP                                                                           | `codigoPostal` pasa a opcional/null; se quita del formulario; NO se agrega otro proveedor                            |
| "General Villegas 5329" + PBA → 3 resultados en 2 partidos; con `departamento=Tres de Febrero` → 2 segmentos con nomenclatura idéntica a ~240 m                                | Regla de deduplicación por identidad territorial; partido obligatorio en PBA                                         |
| El partido Tres de Febrero tiene 1 sola localidad censal; "Caseros" es localidad BAHRA (el filtro `localidad` actual la usa)                                                   | `localidad` opcional en el ingreso; se persiste la `localidad_censal` normalizada                                    |

## 3. Cambios por capa

### 3.1 Modelo y migración

- `lib/models/direccion.js`: nuevos `departamento` (STRING, nullable) y `nomenclatura` (STRING, nullable); `localidad` y `codigoPostal` pasan a `allowNull: true`.
- `db/migrations/20261001000001-modelo-territorial-direccion.js`: agrega `departamento`/`nomenclatura` y retira NOT NULL de `codigoPostal`/`localidad`. Nullable para no romper filas existentes (se completan al editar; backfill pendiente opcional).

### 3.2 `geolocation_service`

- Query con `departamento` y `localidad` **opcionales** (solo si vienen informados). Mínimos: calle, altura, provincia.
- **Deduplicación por identidad territorial** (provincia + departamento + localidad censal + calle): varios segmentos de la misma calle en el mismo partido/comuna no son ambiguos (se toma el primero, orden de relevancia de Georef).
- `DireccionAmbiguaError` ahora incluye **`opciones`** agrupadas por identidad (`{ nomenclatura, provincia, departamento, localidad }`, sin coordenadas) además de `resultados` (compatibilidad).

### 3.3 `direccion_service`

- `CAMPOS_UBICACION` = calle, altura, provincia, **departamento**, **localidad**.
- **Regla territorial**: si la provincia (normalizada, sin acentos) es Buenos Aires y no hay `departamento` → `ErrorValidacionDireccion` ("El partido es obligatorio..."). Se aplica sobre los datos combinados en `prepararDireccion` (cubre también updates parciales que cambian la provincia).
- `validarDatosDireccion`: `departamento`, `localidad` y `codigoPostal` opcionales (null/vacío limpia el campo); provincia sigue siendo obligatoria.
- Al geocodificar, se persisten **normalizados**: `departamento`, `localidad` (localidad censal) y `nomenclatura`. `calle` conserva el texto del usuario (la forma oficial queda en `nomenclatura`).

### 3.4 Manejo de errores (HTTP)

- `DireccionAmbiguaError` → **409** con `{ success, error, opciones }` (antes 422 sin opciones). `DireccionNoEncontradaError` sigue 422; infraestructura 503; cobertura 422 (sin cambios).

### 3.5 Cobertura / ORS

- **Sin cambios** (decisión de la iteración): `evaluarZona` ya compara el `departamento` normalizado contra `cobertura-zonas.js`; la zona CABA filtra solo por provincia y la zona AMBA por lista de partidos (los nombres coinciden con los `departamento` de Georef).

### 3.6 Seeders

- `20260915000001-estados-pedido-sucursales.js`: Sucursal Oeste con `departamento: 'Morón'` (regla PBA); persistencia de `departamento`/`localidad`/`nomenclatura` normalizados.
- `20260915000002-direccion-cliente-demo.js`: persistencia de `departamento`/`localidad`/`nomenclatura` normalizados.

### 3.7 Swagger

- `Direccion` (schema actualizado a `provincia`/`localidad` + nuevos campos), `DireccionRequest` (contrato nuevo; sin latitud/longitud), `DireccionOpcion` nueva, 409 con `opciones` en POST/PUT de `/direcciones`.

## 4. Tests

- `geolocation_service.test.js`: filtros opcionales (con/sin departamento/localidad), localidad ya no es error de validación, ambigua con `opciones` agrupadas (3 resultados → 2 identidades), segmentos de la misma identidad → NO ambigua.
- `direccion_service.test.js`: partido obligatorio en PBA (con tolerancia a acentos/mayúsculas), persistencia normalizada en create/update, campos opcionales.
- `direccion_controller.test.js`: 409 con opciones sin persistir; **reintento con la comuna elegida → 201**; PBA sin partido → 400; CABA sin localidad/CP → 201 con null y datos normalizados; expectativas de errores acumulados actualizadas.
- `sucursal_controller.test.js`: dirección de PBA sin partido → 400; dirección sin localidad/CP (CABA) → 201 con valores normalizados; payload PBA con partido en el test de geocodificación fallando.
- `direccion.test.js` (modelo): obligatorios reducidos a calle/altura/provincia; opcionales departamental/localidad/CP/nomenclatura.
- **Suite completa: 408/408 tests pasan (26 suites)**. `npm run lint` limpio.

## 5. Frontend (misma iteración, rama feat/geolocalizacion)

- `FormularioDireccion` / `FormularioSucursal`: select de provincia (estático), select de partido solo para Buenos Aires (lista estática versionada), localidad opcional, sin código postal, manejo del 409 con lista de opciones y reintento automático.
- Contextos: propagación de `opciones` del 409.

## 6. Pendientes (próximas iteraciones)

- Backfill opcional de `departamento`/`nomenclatura` en direcciones existentes.
- Autocomplete de calles (explícitamente fuera de alcance en esta iteración).
- Alinear el naming del snapshot de `Pedido` (`ciudad` vs `localidad`) — pendiente preexistente.
- Portar la mejora de UX "toast con motivo real al eliminar dirección" a `Perfil.jsx` (la página `MisDirecciones` fue reemplazada por `Perfil` en dev).
