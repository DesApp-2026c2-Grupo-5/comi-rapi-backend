# Informe — Integración de OpenRouteService (RoutingService)

Documento que describe lo efectivamente implementado en la tarea de integración de OpenRouteService como proveedor de rutas del backend. Fuente de verdad vigente: `docs/reglas-negocio.md` (§15), `docs/modelo-dominio.md`, `docs/estructura-backend.md` y `docs/informe-georef.md` (tarea previa).

## 1. Objetivo

Incorporar el cálculo de rutas (distancia y duración) entre dos coordenadas como servicio del backend, siguiendo la separación:

```
Direccion → Georef → latitud/longitud          (ya integrado, tarea previa)
latitud/longitud origen + destino → RoutingService → distancia/duración   (esta tarea)
```

**Georef NO se reemplaza**: sigue siendo el encargado de obtener las coordenadas de una dirección. `RoutingService` recibe coordenadas y calcula la ruta.

## 2. Decisión de proveedor: OSRM vs OpenRouteService

Se evaluaron dos alternativas:

| Alternativa          | Implicaba                                                                                                                                                                                                                          | Evaluación           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **OSRM**             | Servicio de routing autoalojado: preparar datos de OpenStreetMap, generar el dataset, mantener un contenedor/servicio propio. Mayor control, sin API externa, pero agrega infraestructura, almacenamiento y complejidad operativa. | Descartada por ahora |
| **OpenRouteService** | API externa con API key y solicitudes HTTP. Cuotas/límites y dependencia de un servicio externo. Evita infraestructura propia de routing.                                                                                          | **Elegida**          |

**Decisión**: utilizar OpenRouteService por ahora, concentrando el esfuerzo en la lógica funcional del proyecto (alcance académico). Se mantiene la abstracción `RoutingService` para que en el futuro pueda reemplazarse por OSRM u otro proveedor **sin modificar la lógica de negocio**: solo `lib/services/routing_service.js` conoce a OpenRouteService.

## 3. Archivos creados/modificados

| Archivo                                | Acción     | Contenido                                                                                  |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `lib/services/routing_service.js`      | Creado     | Servicio de rutas + errores tipados                                                        |
| `lib/config/config.js`                 | Modificado | Bloque `ors: { baseUrl, apiKey, timeoutMs, profile }` + mecanismo de override `.env.local` |
| `.env.example`                         | Modificado | `ORS_API_KEY` (vacía), `ORS_BASE_URL`, `ORS_TIMEOUT_MS`, `ORS_PROFILE`                     |
| `.env.development`                     | Modificado | Ídem (sin clave real)                                                                      |
| `.env.test`                            | Modificado | Ídem (sin clave real)                                                                      |
| `lib/services/routing_service.test.js` | Creado     | 13 tests con la API mockeada                                                               |
| `docs/reglas-negocio.md`               | Modificado | Nueva sección §15 "Cálculo de rutas (OpenRouteService)"                                    |
| `docs/estructura-backend.md`           | Modificado | Servicio documentado y estado de implementación                                            |
| `docs/modelo-dominio.md`               | Modificado | Regla de negocio (§7.2) actualizada                                                        |

No se modificaron: controllers, routes, modelos, migraciones, frontend, Swagger, `.gitignore` (`.env.local` ya estaba cubierto por el patrón `.env.*`).

## 4. Arquitectura utilizada

- Capa `services` con las convenciones del proyecto (header de documentación, config en `lib/config/config.js`, tests junto al código).
- Aislamiento total de models/controllers: recibe un objeto plano, devuelve un resultado plano. La decisión de usarlo (asignación de sucursal, cobertura, pedidos) queda para tareas posteriores.
- Cliente HTTP: `node-fetch@2` (ya existente desde la tarea de Georef) — **sin dependencias nuevas**, compatible con Node 14.15.x.
- Sin cache, colas ni reintentos (alcance académico).

## 5. Funcionamiento de `RoutingService`

- **`calcularRuta({ origen: { latitud, longitud }, destino: { latitud, longitud } })`**
  1. Valida coordenadas: presentes, numéricas y en rango (lat ±90, lon ±180). Falla sin llamar a la API.
  2. Construye la query: `GET {ORS_BASE_URL}/v2/directions/driving-car?start=<lon,lat>&end=<lon,lat>`. **ORS usa orden `lon,lat`** (inverso a Georef `lat,lon`): la conversión es interna del servicio.
  3. Envía la API key por header `Authorization` (nunca en la URL/query params), con timeout configurable. Importante: el header `Accept` se envía como `application/geo+json, application/json` — ORS rechaza `Accept: application/json` solo con **406 Not Acceptable** (hallazgo de la verificación en vivo).
  4. Valida la respuesta según el estado HTTP y su estructura.
  5. Devuelve `{ distanciaMetros, duracionSegundos, geometria }` — `geometria` es la polyline del trazado que devuelve ORS, incluida solo en la respuesta del servicio: **no se persiste ni se integra con el frontend** en esta etapa.
- **Verificación en vivo** (manual, fuera de los tests): se verificó contra la API real de ORS que el endpoint responde `401` sin credenciales y el formato GeoJSON de éxito (ver §8).

## 6. Configuración agregada

```bash
# En .env.example / .env.development / .env.test (versionados, SIN clave real):
ORS_API_KEY=
ORS_BASE_URL=https://api.openrouteservice.org
ORS_TIMEOUT_MS=5000
ORS_PROFILE=driving-car
```

- **Mecanismo de override**: `initializeEnv` en `lib/config/config.js` carga primero `.env.<NODE_ENV>` y luego `.env.local` (gitignored, que gana). La **clave real** se obtiene gratis desde el dashboard de ORS (HeiGIT: https://openrouteservice.org/dev/#/signup) y se coloca en `.env.local` — **nunca en código ni commiteada**.
- Sin secretos en archivos versionables: los `.env` commiteados dejan `ORS_API_KEY` vacía.

## 7. Manejo de errores

| Caso                                          | Error                                               | Comportamiento                                            |
| --------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| Coordenadas ausentes/inválidas/fuera de rango | `Error` (validación)                                | No se llama a ORS                                         |
| API key ausente en la configuración           | `CredencialesInvalidasError`                        | No se llama a ORS; mensaje indica configurar `.env.local` |
| HTTP 401 (key inválida)                       | `CredencialesInvalidasError` con mensaje de ORS     | Propagado                                                 |
| HTTP 429 (límite de solicitudes)              | `LimiteSolicitudesError`                            | Propagado                                                 |
| HTTP 404 (ruta inexistente)                   | `RutaInexistenteError`                              | Propagado                                                 |
| HTTP 400 u otros 5xx                          | `OrsError` con `status`                             | Propagado                                                 |
| Timeout (FetchError `request-timeout`)        | `OrsError` "Timeout al consultar OpenRouteService"  | Un solo intento, sin retry                                |
| Error de conexión/DNS                         | `OrsError` "Error de conexión con OpenRouteService" | Propagado                                                 |
| JSON inválido                                 | `OrsError`                                          | Propagado                                                 |
| Respuesta sin `features` o sin `summary`      | `OrsError`                                          | Propagado                                                 |

## 8. Estrategia de testing y verificación

- Tests en `lib/services/routing_service.test.js` con `jest.mock('node-fetch')`: **no dependen de una conexión real a OpenRouteService**.
- Fixture con el formato GeoJSON real de ORS v2 (`features[0].properties.summary`).
- Cobertura: resultado exitoso (distancia/duración/geometría), query correcta (baseUrl, profile, orden `lon,lat`, key por header y ausente de la URL), key ausente sin llamar, 401/429/404 (errores tipados), 500 (`OrsError` con status), timeout, conexión, JSON inválido, respuesta sin `features`, respuesta sin `summary`, validación de entrada (sin llamar a ORS).
- **Verificación en vivo** (manual, con la clave del equipo en `.env.local`):
  - Sin credenciales: el endpoint responde `401` (confirma el esquema de autenticación).
  - Con `Accept: application/json`: ORS responde `406 Not Acceptable` — se corrigió el header a `application/geo+json, application/json` (hallazgo de la verificación).
  - Éxito: CABA (-34.6037,-58.3816 → -34.6038,-58.3842) → `distancia = 743.1 m`, `duracion = 182.8 s`, `geometria: LineString (21 puntos)`.
  - Coordenadas fuera de rango: rechazadas por la validación sin llamar a ORS.
  - Coordenadas sin acceso vial (océano): `RutaInexistenteError (404)` con el mensaje de ORS ("Could not find routable point within a radius of 350.0 meters...").
  - **Hallazgo adicional**: el mecanismo de override se corrigió durante la verificación — `.env.local` se carga **antes** que `.env.<NODE_ENV>`, porque dotenv no reemplaza variables ya definidas y el valor vacío de `ORS_API_KEY=` en el archivo versionado bloqueaba la clave real.

## 9. Resultado de los tests ejecutados

- `lib/services/routing_service.test.js`: **13/13 pasan**.
- Suite completa del backend: **132/132 tests pasan** (12 suites), sin regresiones.
- `npm run lint`: limpio.

## 10. Fuera de alcance (explícitamente no implementado)

- Reglas de cobertura y límite de 5 km.
- ABM de `Direccion` (controllers/routes existentes sin cambios).
- Cambios en frontend.
- Cálculo de ETA.
- Infraestructura Docker para OSRM.
- Cache, colas u optimizaciones innecesarias.
- Endpoints nuevos para ORS; Swagger.
- Cambios de modelos o migraciones (no fueron necesarios).

## 11. Relación con las próximas tareas

- **Cobertura (tarea posterior)**: con `GeolocationService` (coordenadas de direcciones) + `RoutingService` (distancias) se podrá implementar la validación de cobertura de sucursales (CABA/AMBA, radio de 5 km, etc.).
- **ABM de `Direccion` (tarea posterior)**: el controller llamará a `geocodificarDireccion()` al crear/actualizar una dirección y persistirá `latitud`/`longitud`.
- **Asignación de sucursal / pedidos (tarea posterior)**: los services de negocio podrán consumir `calcularRuta()` para ordenar sucursales por distancia real y calcular envíos.
- **Migración futura a OSRM**: reemplazar el proveedor implica cambiar solo `lib/services/routing_service.js` (autoalojar el servicio en Docker, generar dataset OSM) sin tocar la lógica de negocio.

```
GeolocationService  → dirección → coordenadas
RoutingService      → coordenadas → distancia/duración (+ geometría)
```
