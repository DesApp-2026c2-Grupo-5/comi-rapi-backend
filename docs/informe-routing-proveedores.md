# Informe — A1: Proveedor de routing seleccionable (ORS/Geoapify) y checkout optimizado con caché de distancias

> Documenta las tarjetas **A1-1 a A1-4** ejecutadas en la rama `feat/routing-proveedores`. Incluye explicación técnica y no técnica, resultados reales de pruebas y mediciones, y lo que queda pendiente.

---

## 1. Objetivo y alcance

**Objetivo**: (1) permitir cambiar el proveedor de cálculo de rutas (OpenRouteService → Geoapify) mediante configuración, conservando ORS como alternativa; (2) eliminar las llamadas síncronas al proveedor durante el checkout, reutilizando distancias ya calculadas; (3) definir las dependencias de las mejoras posteriores (mapa Leaflet, ETA desde `en_camino`, carrito flotante, filtro de precios).

**Alcance ejecutado**:

| Tarjeta | Título                                                                               | Commit    |
| ------- | ------------------------------------------------------------------------------------ | --------- |
| A1-1    | Contrato común de proveedor de routing (`RoutingError` + factory `ROUTING_PROVIDER`) | `36e7344` |
| A1-2    | Proveedor Geoapify detrás del mismo contrato                                         | `09eb77a` |
| A1-3    | Caché persistente de distancias (`DistanciasRutas`)                                  | `0501d52` |
| A1-4    | Selección de sucursal y ETA leen el caché (lazy fail-closed)                         | `a056de1` |

**Fuera de alcance (pendiente)**: A1-5 (observabilidad del proveedor y runbook de operación), gate de suite completa antes del merge a `dev`, promoción a producción, `calcularMatriz` (evaluado y excluido a propósito).

---

## 2. Resumen en lenguaje llano (no técnico)

**El problema**: cada vez que un cliente confirmaba un pedido, la aplicación llamaba por teléfono a un servicio de mapas de Alemania (OpenRouteService) **una vez por sucursal**, una después de la otra, para preguntar "¿a cuánto está esta sucursal de la dirección de entrega?". Con 3 sucursales, el "finalizar compra" tardaba **entre 2,4 y 3,1 segundos** y el "confirmar pago" casi 1 segundo más. Además, ese servicio gratuito tiene un cupo limitado de llamadas por minuto: en una demo con varios pedidos seguidos, se puede agotar y romper la app.

**La solución, en dos pasos**:

1. **Anotar las distancias la primera vez que se calculan.** Cuando un cliente registra su dirección, la app ya llama al servicio de mapas para validar la cobertura (siempre lo hizo). Lo nuevo es que ahora **anota el resultado** en una libreta propia (una tabla nueva de la base de datos) en vez de tirarlo. La distancia entre dos puntos fijos no cambia con el tiempo, así que una vez anotada sirve para siempre.

2. **Consultar la libreta antes de llamar por teléfono.** Al crear un pedido, la app mira la libreta: si la distancia ya está anotada, **no llama a nadie** y responde casi al instante. Si falta una anotación (por ejemplo, abrieron una sucursal nueva), hace **sólo esa llamada** y la anota.

**Resultado medido**: el checkout completo pasó de **~3,3–3,9 segundos** a **~0,2–0,4 segundos** — unas **10 veces más rápido** — y en condiciones normales ya no gasta cupo del servicio de mapas.

**Sobre el cambio de proveedor**: se agregó Geoapify como alternativa a OpenRouteService. Es como cambiar de compañía de teléfono sin cambiar el aparato: **una variable de configuración** elige cuál se usa (`ROUTING_PROVIDER=geoapify` o `ors`) y **volver atrás es cambiar esa variable y reiniciar**, sin tocar código. Las distancias anotadas por un proveedor **nunca se mezclan** con las del otro: si se cambia de proveedor, la libreta arranca de cero y se recalcula sola con el nuevo.

**Seguridad de la decisión de negocio**: si por algún motivo no se puede calcular una distancia que falta (proveedor caído, sin internet), la app **no elige una sucursal al azar ni aproxima**: informa el error, exactamente como hacía antes. Las reglas de cobertura (5 km por ruta), de stock y de reasignación no cambiaron en nada — solo cambió de dónde sale el número de la distancia.

---

## 3. Arquitectura y flujo: antes y después (técnico)

### 3.1 Antes

- `lib/services/routing_service.js` hablaba directamente con ORS (`GET /v2/directions/{profile}?start=lon,lat&end=lon,lat`, key por header `Authorization`).
- `evaluarSucursales` (`cobertura_service.js`) hacía `for…of await calcularRuta` **secuencial por cada sucursal activa** y **descartaba el resultado** (solo usaba la más cercana).
- Toda operación que tocaba cobertura pagaba N llamadas HTTP: crear pedido (T1), confirmar pago (revalidación/auto-reasignación + ETA), reasignar manual (T4), alta/preview de dirección. Timeout 5 s, sin retry ni caché, cuota ORS 40 req/min.

### 3.2 Después, por capa

**Contrato de proveedor (A1-1)**

```
lib/services/routing_service.js           ← facade: re-exporta el contrato (0 cambios en consumidores)
lib/services/providers/routing/
  ├── errors.js      → RoutingError (base) ⊃ OrsError ⊃ CredencialesInvalidasError / LimiteSolicitudesError / RutaInexistenteError
  ├── validacion.js → validación de coordenadas compartida por todos los proveedores
  ├── ors.js        → OpenRouteService (implementación histórica, movida textual)
  ├── geoapify.js   → Geoapify (A1-2): /v1/routing, waypoints lat,lon, key por query param
  └── index.js      → factory: PROVEEDORES = { ors, geoapify }, selecciona por config.routing.proveedor
```

`error_handler.js` traduce `instanceof RoutingError` → 503: cualquier proveedor da el mismo HTTP.

**Caché de distancias (A1-3)**

- Tabla **`DistanciasRutas`** (migración `20261016000001-create-distancias-rutas.js`): `origen*` = coords de la **sucursal**, `destino*` = coords de **entrega** (semántica de `routing_service`), `distanciaMetros`, `duracionSegundos`, `proveedor`, `calculadoEn`, `sucursalId` (metadato, `ON DELETE SET NULL`). **UNIQUE (4 coords + proveedor)**.
- `distancias_service.js`: `redondearCoord` (6 decimales — única fuente de claves), `guardarDistancias` (`INSERT … ON CONFLICT DO UPDATE`, **best-effort**: warn sin romper).
- `evaluarSucursales` persiste **cada par que calcula en vivo** (incluida la `duracionSegundos` que antes se descartaba).

**Lectura cache-first (A1-4)**

- `obtenerDistanciasCacheadas({ destino, origenes })`: un `findOne` por par usando la UNIQUE completa, filtrando por **proveedor activo**.
- `obtenerOCalcularDistancia({ origen, destino, sucursalId })`: caché → miss → live → auto-guardado. **Fail-closed**: propaga errores tipados.
- `sucursalesEnCobertura` (el seam único de T1, T4 y la auto-reasignación al pagar): lee el caché → los pares faltantes van a `evaluarSucursales` (live + cacheo) → merge → **el radio se aplica con el parámetro vigente** (`radioCoberturaKm` de `ParametrosSistema`) → orden por distancia.
- `eta_service.calcularEta`: delega en `obtenerOCalcularDistancia` (degradación intacta: falla → `etaMinutos` null, el pago nunca se bloquea).

### 3.3 El flujo del checkout después

```
POST /api/pedidos   → T0 snapshot (coords de la Direccion) → T1 seleccionarSucursal
                      → sucursalesEnCobertura → CACHÉ (0 llamadas HTTP si está caliente)
                      → ranking por distancia → filtro stock (DB) → sucursal asignada
PATCH /:id/estado   → revalida reserva → (auto-reasignación vía caché si venció) → ETA vía caché
```

El **alta/preview de direcciones sigue validando EN VIVO** (momento autoritativo de la regla de 5 km y principal calentador del caché) — decisión aprobada explícitamente.

---

## 4. Archivos, módulos, configuración y migraciones

| Tipo           | Detalle                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migración**  | `db/migrations/20261016000001-create-distancias-rutas.js` (única DB change del plan; ya aplicada en dev y test — los compañeros deben correr `npm run db:migrate` al traer la rama)                                                                                                                                          |
| **Modelos**    | `lib/models/distancia_ruta.js` (nuevo)                                                                                                                                                                                                                                                                                       |
| **Servicios**  | `distancias_service.js` (nuevo), `cobertura_service.js`, `eta_service.js`, `providers/routing/{index,ors,geoapify,errors,validacion}.js` (nuevos salvo los dos últimos también nuevos)                                                                                                                                       |
| **Middleware** | `error_handler.js` (`instanceof RoutingError`)                                                                                                                                                                                                                                                                               |
| **Config**     | `lib/config/config.js`: `routing.proveedor` (`ROUTING_PROVIDER`), bloque `geoapify` (`GEOAPIFY_*`)                                                                                                                                                                                                                           |
| **Env**        | `.env.example` documenta `ROUTING_PROVIDER`, `GEOAPIFY_API_KEY/BASE_URL/TIMEOUT_MS/MODE`; claves reales van en `.env.local` (gitignored)                                                                                                                                                                                     |
| **Tests**      | `providers/routing/index.test.js`, `geoapify.test.js` (nuevos), `distancias_service.test.js` (nuevo), `cobertura_service.cache.test.js` (nuevo, integración), `eta_service.test.js` (reescrito), `cobertura_service.test.js` (+mock), `distancia_ruta.test.js` (nuevo), `routing_service.test.js` (intacto contra el facade) |
| **Docs**       | `docs/DER.md` (§2.21), `docs/reglas-negocio.md` (§15 contrato+caché, §20.1/20.2 fuente del ranking/ETA), este informe                                                                                                                                                                                                        |
| **Otros**      | `.nvmrc` → `14.15` único (coherente con `engines`; ver §9.4)                                                                                                                                                                                                                                                                 |

---

## 5. Cómo elegir Geoapify u ORS — y cómo volver atrás

```bash
# .env.local (o el .env del entorno)
ROUTING_PROVIDER=geoapify   # u "ors" (default si falta la variable)
```

- Reiniciar el backend. **No hay deploy de código**: la factory resuelve el proveedor por request.
- **Vuelta a ORS**: `ROUTING_PROVIDER=ors` + reiniciar. Las filas del caché de Geoapify quedan guardadas pero **no se reutilizan** (la lectura filtra por proveedor activo); el caché efectivo de ORS ya está (o se recalcula lazy).
- Ambos proveedores comparten validación de entrada, contrato de errores y timeouts (5000 ms por defecto, `ORS_TIMEOUT_MS` / `GEOAPIFY_TIMEOUT_MS`).

**Sanity check del cambio de proveedor (ejecutado con key real, A1-2)**: mismo par de coordenadas, 3 casos:

| Par                                     | ORS             | Geoapify        | Drift distancia                        |
| --------------------------------------- | --------------- | --------------- | -------------------------------------- |
| Palermo → Av. Santa Fe 3700             | 588 m / 78 s    | 588 m / 47 s    | **0,0%**                               |
| Oeste → Vergara 1593                    | 1.641 m / 214 s | 1.625 m / 139 s | **1,0%**                               |
| Oeste → Palermo (17 km, fuera de radio) | 29.187 m        | 33.325 m        | 14,2% (irrelevante: ambos lo excluyen) |

Dentro del radio de cobertura (lo único que decide negocio) el drift es 0–1%, muy por debajo del ±2% aceptado. Las duraciones difieren más (modelos de velocidad distintos) → impacto en ETA ≤ 1 minuto.

---

## 6. Cómo se calculan, guardan, reutilizan e invalidan las distancias

- **Se calculan** en vivo en el único punto donde siempre se calcularon: `evaluarSucursales` (alta/preview de dirección, y lazy para pares faltantes).
- **Se guardan** por par `(coords sucursal, coords entrega, proveedor)` con `INSERT … ON CONFLICT DO UPDATE` — idempotente, sin races (dos checkouts fríos simultáneos no duplican).
- **Se reutilizan** en: selección T1 (crear pedido), revalidación/auto-reasignación al confirmar pago, reasignación manual T4, y ETA. Con caché caliente: **cero llamadas HTTP al proveedor** en todo el ciclo.
- **Se invalidan por diseño, sin DELETE**: si una dirección o sucursal cambia de coordenadas, las claves nuevas no matchean las filas viejas — quedan inalcanzables, no incorrectas. **Sin TTL** (la distancia entre dos puntos fijos no vence). El radio, en cambio, **sí** se re-evalúa en cada lectura con el parámetro vigente.
- **Nunca se comparten entre proveedores**: el `proveedor` forma parte de la clave UNIQUE y de la lectura.
- Las **bajas de entidades de negocio siguen siendo lógicas** (sucursales `activa:false`, etc.); `DistanciasRutas` es un dato derivado recomputable, no una entidad.

---

## 7. Reglas preservadas

| Regla                                                                                   | Estado                                                                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Cobertura ≤ 5 km **por ruta** (parámetro `radioCoberturaKm`)                            | Intacta — mismo umbral, mismo filtro; el radio vigente se aplica SIEMPRE (aunque el par se haya cacheado con otro radio)               |
| Selección D1: la más cercana por ruta **con stock**, dentro de cobertura                | Intacta — solo cambió la fuente de la distancia (`seleccion_sucursal_service.js` no se tocó)                                           |
| Reasignación automática al pagar (excepto la original)                                  | Intacta — fluye por el mismo seam                                                                                                      |
| Reasignación manual T4 (estados, stock, cobertura, transferencia atómica, trazabilidad) | Intacta (`reasignacion_service.js` no se tocó)                                                                                         |
| ETA = cocina 30 + viaje por ruta; degradación sin bloquear el pago                      | Intacta — la duración sale del caché o se calcula                                                                                      |
| Alta/preview de dirección valida cobertura **en vivo**                                  | Intacta por decisión aprobada                                                                                                          |
| Fail-closed                                                                             | Intacta — error del proveedor en un par faltante → error tipado (503), **nunca** asignación arbitraria ni aproximación por línea recta |
| Sin nuevos estados, sin nuevas reglas de negocio                                        | Confirmado                                                                                                                             |

---

## 8. Pruebas ejecutadas y resultados reales

### 8.1 Automáticas (por tarjeta, suites relacionadas — el gate completo se corre antes del merge)

| Tarjeta | Suites corridas                                                                                                                                                                                                                                                                                                                                                                                                                                        | Resultado                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| A1-1    | facade + factory + cobertura + eta                                                                                                                                                                                                                                                                                                                                                                                                                     | 51/51; **suite completa del repo en ese momento: 36/36 suites, 573/573 tests** (1 flake preexistente, ver §9.2) |
| A1-2    | providers/routing + geoapify (11 nuevos) + cobertura + eta                                                                                                                                                                                                                                                                                                                                                                                             | 62/62                                                                                                           |
| A1-3    | distancia_ruta (7 nuevos, DB real) + cobertura (27) + routing                                                                                                                                                                                                                                                                                                                                                                                          | 50/50                                                                                                           |
| A1-4    | **10 suites / 105 tests**: `cobertura_service.cache.test.js` (5: **0 llamadas al proveedor con caché caliente**, radio vigente, lazy de 1 llamada + auto-cacheo + relectura sin llamadas, filtro por proveedor, fail-closed), `distancias_service.test.js` (7: claves estables, hit/miss/self-healing, propagación de errores), eta reescrito (7), cobertura mocked (27), routing (17), distancia_ruta (7), selección/reasignación (regresión intacta) | **105/105**                                                                                                     |

### 8.2 Verificación real end-to-end (DB dev, proveedor real)

- Validación de dirección real (`AV GDOR VERGARA 1593, Hurlingham`) **dos veces**: primera → 3 filas en `DistanciasRutas` (una por sucursal activa geolocalizada, `proveedor='ors'`); segunda → **siguen 3** (ON CONFLICT actualiza, no duplica). Distancia a Oeste: 1.641 m, idéntica al smoke de A1-2.
- Flujo HTTP completo (login cliente → POST /api/pedidos → PATCH confirmado) contra el server real: 201 + 200 en las 6 corridas (3 baseline + 3 post).

### 8.3 Medición de performance (el criterio de aceptación)

Medido con script propio (3 corridas por estado, DB dev, 3 sucursales activas, dirección con caché caliente para el "después"):

| Paso                   | Baseline (en vivo)           | A1-4 (caché)           | Mejora   |
| ---------------------- | ---------------------------- | ---------------------- | -------- |
| POST /api/pedidos      | 2.389 / 2.644 / 3.073 ms     | 132 / 260 / 282 ms     | ~10–15×  |
| CONFIRMAR (pago + ETA) | 811 / 846 / 885 ms           | 64 / 70 / 118 ms       | ~8–10×   |
| **TOTAL checkout**     | **3.274 / 3.455 / 3.919 ms** | **196 / 330 / 400 ms** | **~10×** |

**Objetivo aprobado (< 500 ms locales con caché caliente): CUMPLIDO** (196–400 ms medidos en backend).

### 8.4 Pendientes (no declararlas hechas)

- **Gate de suite completa** sobre la rama final antes del merge a `dev`.
- Verificación manual por la web del flujo completo con `ROUTING_PROVIDER=geoapify` (alta de dirección + pedido) — el smoke de servicio ya pasó, falta la pasada visual.
- A1-5: log/observabilidad del proveedor por llamada y runbook de operación.

---

## 9. Problemas encontrados, limitaciones y riesgos

1. **OneDrive bloquea el build** (recurrente, confirmado): `rimraf dist` falla con `EPERM` porque OneDrive marca carpetas nuevas de `dist` como solo-lectura mientras sincroniza. **Fix probado**: `attrib -R dist /S /D` + `Remove-Item -Recurse -Force dist` + `npm run build`. Aplica a todo el equipo (el repo vive bajo OneDrive).
2. **Suite realtime preexistente flaky** (`conexion.test.js`): mockea la selección pero deja que el ETA llame a ORS real; con la máquina cargada puede agotar timeouts. **No introducido por A1** (existe desde antes); con caché caliente el ETA en producción ya no llama al proveedor, pero el test no se beneficia porque no calienta el caché. Pendiente como deuda de tests.
3. **Caché frío tras cambiar de proveedor**: el primer alta/pedido por dirección recalcula sus pares (nunca peor que el comportamiento actual); después, instantáneo.
4. **`.nvmrc`**: quedó una sola línea `14.15` (antes `lts/fermium`, que resuelve a 14.21.3). En Linux/Mac `nvm use` lo toma automáticamente; **nvm-windows ignora `.nvmrc`** (limitación de la herramienta, no del archivo).
5. **Producción NO tocada** (por decisión del equipo): `master`/`main` siguen sin el fix de cobertura (`3cb310c` está solo en `dev`) y sin A1. La promoción final debe llevar ambos.

---

## 10. Configuración de entorno y reproducibilidad

```bash
# .env.local del backend (gitignored; gana sobre los .env versionados)
ORS_API_KEY=<clave OpenRouteService>          # ya existente
GEOAPIFY_API_KEY=<clave Geoapify>            # nueva (ya configurada en la máquina de desarrollo)
ROUTING_PROVIDER=ors                          # opcional: 'geoapify' para cambiar de proveedor
```

Variables completas documentadas en `.env.example` (`ORS_*`, `GEOAPIFY_*`, `ROUTING_PROVIDER`).

**Pasos para reproducir**:

1. `git checkout feat/routing-proveedores && npm install` (sin cambios de dependencias).
2. `npm run db:migrate` (crea `DistanciasRutas`) y `NODE_ENV=test npx sequelize db:migrate`.
3. `npm run build && node .\dist\bin\www`.
4. Alta de una dirección por la web (o `POST /api/direcciones`) → verificar: `SELECT COUNT(*) FROM "DistanciasRutas"` = una fila por sucursal activa geolocalizada.
5. Crear un pedido → medir: con caché caliente el POST no debe llamar al proveedor (verificar en el log la ausencia de warnings/latencia < 500 ms).
6. Cambiar `ROUTING_PROVIDER=geoapify`, reiniciar, repetir: el caché efectivo arranca vacío (primer cálculo lazy) y luego todo vuelve a ser instantáneo.
7. Tests: `npx cross-env NODE_ENV=test jest lib/services/distancias_service.test.js lib/services/cobertura_service.cache.test.js --runInBand`.

---

## 11. Commits, ramas y estado de publicación

| Commit        | Tarjeta | Contenido                                                                               |
| ------------- | ------- | --------------------------------------------------------------------------------------- |
| `36e7344`     | A1-1    | Contrato de proveedor + factory + `RoutingError` + facade + `.nvmrc`                    |
| `09eb77a`     | A1-2    | Proveedor Geoapify + validación compartida + config/env + docs §15                      |
| `0501d52`     | A1-3    | Migración + modelo + `distancias_service` (escritura) + persistencia en evaluación viva |
| `a056de1`     | A1-4    | Ranking cache-first + ETA desde caché + suites unit/integración                         |
| (este commit) | —       | Informe                                                                                 |

**Rama**: `feat/routing-proveedores` (base: `dev` @ `ff3919d`), **local, sin push** — pendiente de revisión y del gate de suite completa antes del merge a `dev`. `master`/`main` sin cambios (y aún con el bug de cobertura `4a8369f`, cuyo fix `3cb310c` vive en `dev` — la promoción final debe resolverlo).
