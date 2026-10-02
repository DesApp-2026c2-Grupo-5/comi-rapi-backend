# Informe — Iteración 3: cascada territorial, autocomplete, preview y fixes de bugs

Documento que describe lo efectivamente implementado en la iteración 3 de la mejora de Direcciones y Geolocalización. Fuentes: `docs/reglas-negocio.md` (§14, §17, §18, §19), informe de la iteración 1-geo. **Sin commit: queda para revisión manual.**

## 1. Objetivo

1. Selects en cascada: provincia → partido/comuna → localidad (BAHRA; en CABA son los barrios).
2. Autocompletado de calles con nombres oficiales.
3. Selección de coincidencias robusta cuando Georef devuelve varias identidades territoriales, **antes** de conectar el flujo con la validación definitiva de cobertura (requisito de orden).
4. Auto-completado visible de calle normalizada, localidad y coordenadas (el código postal **no**: Georef no lo provee — re-confirmado; queda null).
5. Aviso de cobertura al seleccionar la provincia.
6. Corrección de los tres bugs detectados en el testeo manual del cliente.

## 2. Bugs reportados y sus causas raíz (verificadas contra la API real)

| Bug                                                                                                                      | Causa raíz                                                                                                                                                                                                                                                                             | Fix                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A: al elegir la comuna (juan b justo 4200, CABA) el error era "no pudo ser ubicada" en lugar del error real de cobertura | `elegirOpcion` copiaba la **localidad censal** ("Ciudad Autónoma de Buenos Aires") al campo `localidad`, cuyo filtro en Georef matchea localidades **BAHRA** (los barrios) → query con nombre censal = **0 resultados** (reproducido en vivo)                                          | Al elegir una opción solo se aplican el `departamento` y la **calle oficial**; el reintento queda determinista                                  |
| B: el check de opciones no reaparecía al reintentar; había que recargar                                                  | El `departamento` (y la localidad rota) quedaban en estado del formulario, **invisible en CABA** (el select solo se renderizaba para PBA): cada submit reenviaba los filtros rotos                                                                                                     | Partido/comuna siempre visible (select opcional en CABA); cualquier edición de calle/altura/provincia/partido **invalida la resolución previa** |
| C: la pantalla quedaba congelada al eliminar una dirección                                                               | `confirmarEliminarDireccion` sin try/finally (un fallo de la API dejaba `eliminandoDireccion=true` con los botones deshabilitados) + `ConfirmarModal` apilado sobre el modal de direcciones (backdrop trabado, pantalla bloqueada) + `ok ?` evaluaba el objeto `{ok}` (siempre truthy) | try/finally + evaluación `ok?.ok` + confirmación **inline** dentro del modal (sin modal apilado)                                                |

## 3. Backend

| Archivo                                                                                | Acción      | Contenido                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/services/geolocation_service.js`                                                  | Modificado  | `llamarGeoref(ruta, campoEsperado)` genérica y exportada; `aOpcion` con `calle` oficial; nueva `resolverDireccion` (no-lanzante: `unica`/`ambigua`/`no_encontrada`) reutilizando la deduplicación por identidad territorial |
| `lib/services/geo_catalogo_service.js`                                                 | Creado      | Proxy con **cache en memoria** (TTL 24 h catálogos / 5 min autocomplete): `obtenerDepartamentos`, `obtenerLocalidades` (BAHRA), `buscarCalles`, `obtenerZonas` (deriva de `cobertura-zonas.js`), `limpiarCache` (tests)     |
| `lib/routes/geo.js`                                                                    | Creado      | Endpoints públicos `/api/geo/{departamentos,localidades,calles,zonas,preview}`; validación 400 en ruta; preview con CSRF como todo POST                                                                                     |
| `lib/routes/index.js`                                                                  | Modificado  | Registro de `/api/geo`                                                                                                                                                                                                      |
| `lib/services/geo_catalogo_service.test.js`                                            | Creado      | 9 tests: mapeo, validación, política de cache (misma clave no re-consulta; mayúsculas/minúsculas)                                                                                                                           |
| `lib/routes/geo.test.js`                                                               | Creado      | 13 tests: públicos sin sesión, 400, autocompletado <3 letras sin consultar Georef, preview única/ambigua (opciones con calle oficial)/no_encontrada/400/503                                                                 |
| `docs/swagger.yml`, `docs/reglas-negocio.md` (§19 nueva), `docs/estructura-backend.md` | Modificados | 5 endpoints documentados; nota de cambio por sección                                                                                                                                                                        |

## 4. Frontend

| Archivo                                          | Acción     | Contenido                                                                                                                                                                                                             |
| ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/geo.js`                                 | Creado     | Cliente del proxy (5 funciones)                                                                                                                                                                                       |
| `src/hooks/useDireccionTerritorial.js`           | Creado     | Lógica territorial compartida: cascada, debounce de autocomplete, aviso de provincia (texto: "Por el momento solo operamos en CABA y en algunos partidos de la provincia Buenos Aires."), flujo de preview, fixes A/B |
| `src/components/cliente/FormularioDireccion.jsx` | Reescrito  | Verificar → (ambigua: radios → re-verificar) → confirmación con nomenclatura + coordenadas → guardar                                                                                                                  |
| `src/components/admin/FormularioSucursal.jsx`    | Reescrito  | Mismo flujo para la dirección anidada                                                                                                                                                                                 |
| `src/pages/cliente/Perfil.jsx`                   | Modificado | Fix bug C (try/finally, `ok?.ok`, confirmación inline)                                                                                                                                                                |
| `src/pages/admin/EditarSucursal.jsx`             | Modificado | Errores del guardado centralizados en el formulario (banner de página retirado)                                                                                                                                       |
| `src/utils/territorio.js`                        | Modificado | Solo `PROVINCIAS` estáticas; partidos/comunas y localidades ahora viven en el proxy (única fuente)                                                                                                                    |

## 5. Decisiones conservadas

- **CP**: queda null/omitido (Georef no lo provee; no se incorporan otros proveedores).
- **Flujo de orden**: preview (sin persistir ni validar cobertura) → selección → confirmación → guardado con cobertura definitiva. El contrato del POST/PUT de direcciones **no cambió** (el 409 con opciones se mantiene como red de seguridad).
- **Cobertura/ORS**: sin cambios de reglas.
- **Cache**: única con Georef (ToS); sin dependencias nuevas; Node 14 compatible.

## 6. Verificación

- Backend: suite completa con `--runInBand` (Node 14) — ver resultado en el reporte de cierre; `npm run lint` limpio; build Babel OK.
- Frontend: `vite build` OK.
- Verificación manual E2E sugerida (reproduce el caso del bug): "juan b justo 4200" + CABA → deben aparecer las comunas → elegir una → la confirmación muestra la dirección resuelta → al guardar debe aparecer el **error real de cobertura** (no "no pudo ser ubicada"); reintentos sin recargar; eliminar dirección sin congelamiento.

## 7. Pendientes (próximas iteraciones)

- Autocomplete persistente con highlights/debuncing avanzado y selector por teclado (la versión actual es funcional, minimal).
- Backfill opcional de direcciones existentes (`departamento`/`nomenclatura`).
- Alineación del snapshot de `Pedido` (`ciudad` → `localidad`).

## 8. Correcciones post-testeo manual (bugs del autocompletado)

Causas verificadas contra el código y la API real; correcciones aplicadas sobre el mismo árbol sin commitear (a revisión):

| Bug                                                          | Causa raíz                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1: la búsqueda de calle "no funciona" al abrir el formulario | La query exige `provincia` y el campo Calle estaba habilitado de entrada: tipear antes de elegir provincia fallaba **en silencio** (sin rama de error); además, respuestas lentas obsoletas podían sobrescribir la actual (sin cancelación) | Calle deshabilitada hasta elegir provincia, con hint; feedback visible de fallo (`errorSugerencias`); flag `cancelado` que descarta respuestas obsoletas                                                                                                           |
| 2: selects territoriales incómodos                           | `Form.Select` nativo: solo "salta" por inicial, sin búsqueda                                                                                                                                                                                | `Autocomplete` reutilizable (texto libre para BUSCAR, lista filtrada client-side ordenada, selección explícita de una opción válida; el texto libre se descarta al salir del campo). Validación de pertenencia en el hook como red de seguridad                    |
| 3: sugerencias de calle indistinguibles                      | Georef devuelve **calles distintas** con el mismo nombre (una por comuna/partido, ids distintos); el UI mostraba solo `nombre`                                                                                                              | La sugerencia muestra el nombre oficial + `nomenclatura` ("AV JUAN B JUSTO, Comuna 9, CABA") que ya viajaba en la respuesta (`campos=estandar`). **No se deduplica ninguna opción legítima**; test de contrato en `geo.test.js` fija `departamento`/`nomenclatura` |
| 4: las sugerencias reaparecen tras seleccionar               | `seleccionarSugerencia` seteaba `calle` → el effect de autocomplete se re-disparaba con ese texto → re-buscaba → la lista se reabría (a veces varias veces)                                                                                 | `calleSeleccionadaRef`: mientras el texto coincide con la selección, no se re-busca; al volver a tipear se rehabilita. Combinado con la cancelación de respuestas obsoletas                                                                                        |
