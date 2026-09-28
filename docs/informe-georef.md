# Informe — Integración de Georef Argentina

Documento que describe lo efectivamente implementado en la tarea de integración de Georef Argentina como servicio de geocodificación del backend. Fuente de verdad vigente: `docs/reglas-negocio.md` (§14), `docs/modelo-dominio.md` y `docs/estructura-backend.md`.

## 1. Objetivo

Incorporar Georef Argentina (https://apis.datos.gob.ar/georef, API pública sin secretos) como servicio de geocodificación del backend: dado los datos de una `Direccion` (`calle`, `altura`, `provincia`, `localidad`), obtener su ubicación geográfica (`latitud`/`longitud`) más los datos normalizados que devuelve Georef. El servicio queda aislado de las reglas de negocio y preparado para las tareas posteriores (ABM de `Direccion`, OSRM, cobertura).

## 2. Archivos creados/modificados

| Archivo                                    | Acción     | Contenido                                                          |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------ |
| `lib/services/geolocation_service.js`      | Creado     | Servicio de geocodificación + errores tipados                      |
| `lib/config/config.js`                     | Modificado | Bloque `georef: { baseUrl, timeoutMs, maxResultados }`             |
| `.env.example`                             | Modificado | `GEOREF_BASE_URL`, `GEOREF_TIMEOUT_MS`, `GEOREF_MAX_RESULTADOS`    |
| `.env.development`                         | Modificado | Ídem (valores por defecto para dev)                                |
| `.env.test`                                | Modificado | Ídem (valores por defecto para test)                               |
| `package.json` / `package-lock.json`       | Modificado | Dependencia `node-fetch@^2.7.0` (compatible con Node 14)           |
| `lib/services/geolocation_service.test.js` | Creado     | 13 tests con la API HTTP mockeada                                  |
| `docs/reglas-negocio.md`                   | Modificado | Nueva sección §14 "Geolocalización (Georef Argentina)"             |
| `docs/estructura-backend.md`               | Modificado | Servicio documentado en `lib/services/` y estado de implementación |
| `docs/modelo-dominio.md`                   | Modificado | Reglas §5.2 y §7.2 actualizadas (geocodificación)                  |

## 3. Arquitectura utilizada

- Capa `services` siguiendo las convenciones del proyecto (header de documentación, config en `lib/config/config.js`, tests junto al código como `*.test.js`).
- El servicio **no** toca modelos, controllers ni routes: recibe un objeto plano de datos de dirección y devuelve un resultado plano. La persistencia en `Direccion` quedará en el ABM/controller (tarea posterior).
- Comunicación HTTP con `node-fetch@2` (compatible con Node 14.15.x, timeout nativo, mockeable con `jest.mock`).
- Sin secretos: Georef es una API pública. Se envía un header `User-Agent: comi-rapi-backend` como identificación del backend.

## 4. Funcionamiento de `GeolocationService`

- **`geocodificarDireccion({ calle, altura, provincia, localidad })`**
  1. Valida presencia de los datos mínimos (falta cualquiera → error de validación, sin llamar a Georef).
  2. Construye la query: `GET {GEOREF_BASE_URL}/api/direcciones?direccion=<calle> <altura>&provincia=<provincia>&localidad=<localidad>&campos=calle,provincia,departamento,localidad_censal,altura,ubicacion,nomenclatura&max=<GEOREF_MAX_RESULTADOS>`.
  3. Ejecuta la llamada con timeout y valida la estructura general de la respuesta.
  4. Interpreta los resultados: 0 → `DireccionNoEncontradaError`; >1 → `DireccionAmbiguaError` (con `resultados`); 1 → normaliza.
  5. Devuelve `{ latitud, longitud, nomenclatura, normalizada: { calle, provincia, departamento, localidad } }`.
- **`buscarDirecciones({ ... })`**: misma query, devuelve la lista cruda de `direcciones` sin interpretar (para desambiguación futura). Nota: no lanza el error de "no encontrada"; devuelve la lista (vacía o no) tal como la dio Georef.
- **Verificación en vivo** (manual, fuera de los tests): Av. Corrientes 1234, CABA → `latitud: -34.60385632930893`, `longitud: -58.38419018127011`, `nomenclatura: "AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires"`. Dirección inexistente → `DireccionNoEncontradaError`.

## 5. Configuración agregada

```bash
GEOREF_BASE_URL=https://apis.datos.gob.ar/georef
GEOREF_TIMEOUT_MS=5000
GEOREF_MAX_RESULTADOS=10
```

Con defaults en código (mismos valores) para no romper entornos sin `.env`. Sin secretos ni credenciales.

## 6. Manejo de errores

| Caso                                                       | Error                                                  | Comportamiento                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Datos insuficientes (sin calle/altura/provincia/localidad) | `Error` (validación)                                   | No se llama a Georef                                                                   |
| Georef no encuentra la dirección (`total = 0`)             | `DireccionNoEncontradaError`                           | Propagado al llamador                                                                  |
| Más de un resultado (`total > 1`)                          | `DireccionAmbiguaError` con `resultados`               | No se elige automáticamente; la decisión queda para la tarea de integración con el ABM |
| HTTP 4xx/5xx                                               | `GeorefError` con `status` y `causa`                   | Propagado                                                                              |
| Timeout (FetchError `request-timeout`)                     | `GeorefError` "Timeout al consultar Georef Argentina"  | Un solo intento, sin retry (ToS de Georef)                                             |
| Error de conexión/DNS                                      | `GeorefError` "Error de conexión con Georef Argentina" | Propagado                                                                              |
| JSON inválido                                              | `GeorefError`                                          | Propagado                                                                              |
| Respuesta sin `direcciones` (incompleta)                   | `GeorefError`                                          | Propagado                                                                              |
| Resultado único sin `ubicacion`                            | `GeorefError`                                          | Propagado                                                                              |

## 7. Estrategia de testing

- Tests en `lib/services/geolocation_service.test.js` con `jest.mock('node-fetch')`: **no dependen de una conexión real a Georef**.
- Fixture basado en una respuesta real capturada de la API pública (Av. Corrientes 1234, CABA).
- Cobertura: resultado exitoso (latitud/longitud/nomenclatura/normalizada), query construida (baseUrl, `direccion` calle+altura, provincia, localidad, `max`, `campos`, header `User-Agent`), no encontrada, ambigua (con resultados), HTTP 500 (con status), timeout, error de conexión, JSON inválido, respuesta incompleta, resultado sin ubicación, validación de entrada (sin llamar a Georef) y `buscarDirecciones` (lista cruda + validación).

## 8. Resultado de los tests ejecutados

- `lib/services/geolocation_service.test.js`: **13/13 pasan**.
- Suite completa del backend: **110/110 tests pasan** (10 suites), sin regresiones.
- `npm run lint`: limpio.
- Verificación en vivo contra Georef real: geocodificación exitosa y errores tipados funcionando.

## 9. Decisiones importantes

1. **Cliente HTTP**: `node-fetch@2` (elegido por compatibilidad con Node 14, API limpia, timeout nativo, mockeable).
2. **Datos normalizados**: se devuelven en el resultado pero **no se persisten**; persistirlos implicaría cambios de modelo. La tarea posterior decidirá si los usa (ej. validar provincia con `provincia.nombre`, presentar con `nomenclatura`).
3. **Ambigüedad**: el servicio lanza `DireccionAmbiguaError` con los resultados; la elección queda para la tarea de integración con el ABM (no se toma el primero automáticamente).
4. **Sin retry**: un intento con timeout configurable, respetando el ToS de Georef.
5. **`codigoPostal` no se envía en la query**: el endpoint `direcciones` de Georef no lo admite; el CP queda disponible para validaciones posteriores (ej. cobertura).
6. **`buscarDirecciones` no interpreta**: devuelve la lista cruda, separando la comunicación de la interpretación de resultados.

## 10. Fuera de alcance (explícitamente no implementado)

- OSRM, cálculo de distancias, cálculo de rutas/duraciones.
- Reglas de cobertura, validación CABA/AMBA, radio de 5 km.
- Integración con el ABM de `Direccion` (controllers/routes existentes sin cambios).
- Endpoints nuevos para Georef.
- Cambios de frontend.
- Cambios de modelos o migraciones (no fueron necesarios: `Direccion` ya tiene `latitud`/`longitud`).
- Swagger.

## 11. Relación con las próximas tareas

- **ABM de `Direccion` (tarea posterior)**: al crear/actualizar una dirección, el controller llamará a `geocodificarDireccion()` y persistirá `latitud`/`longitud` en `Direccion`. Deberá decidir el manejo de `DireccionNoEncontradaError`/`DireccionAmbiguaError` a nivel HTTP (400/409, mensaje al usuario).
- **Cobertura (tarea posterior)**: con las coordenadas persistidas se podrá validar cobertura de sucursales (CABA/AMBA, radio de 5 km, etc.).
- **OSRM (tarea posterior)**: se prevé un `RoutingService` separado (`coordenadas → distancia/duración`), siguiendo el patrón de este servicio (`GeolocationService → dirección → coordenadas`).

```
GeolocationService  → dirección → coordenadas
RoutingService      → coordenadas → distancia/duración (OSRM, tarea posterior)
```
