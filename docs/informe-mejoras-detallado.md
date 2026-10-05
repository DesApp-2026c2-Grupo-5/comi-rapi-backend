# Informe detallado — Mejoras de Direcciones y Geolocalización (Iteraciones 1–6)

Consolidación de los informes de las **iteraciones** de la mejora de Direcciones y Geolocalización de Comi-Rapi. Cada módulo corresponde a una mejora. Los informes por tarea (Georef, ORS, cobertura, ABM, 6.1, Swagger) y el flujo completo están en `informe-*.md` y `flujo-direcciones-geolocalizacion.md` / `-resumen.md`; este archivo reemplaza a los archivos individuales de iteración. Resumen ejecutivo: `informe-mejoras-resumen.md`.

Fuentes de verdad: `docs/reglas-negocio.md` (§7, §14–§19), `docs/DER.md`, `docs/modelo-dominio.md`.

## Módulo 1 — Iteración 1: Modelo territorial y desambiguación de direcciones

**Objetivo.** Alinear `Direccion` y el flujo de ingreso con el modelo territorial real de Georef Argentina (verificado en vivo contra su API y documentación oficial) y reemplazar el rechazo seco "Dirección ambigua" por una selección de coincidencias.

**Hechos verificados contra Georef.** `/api/direcciones` acepta filtros `provincia`/`departamento`/`localidad_censal`/`localidad` (no `municipio`); en Buenos Aires el `departamento` **es** el partido y en CABA son las **15 comunas** (INDEC Res. 55/2019); en CABA la localidad censal es única y **no hay endpoint de barrios**; la respuesta no incluye **código postal**; caso real "General Villegas 5329": 3 resultados en 2 partidos, y filtrando por partido quedan 2 segmentos con nomenclatura idéntica a ~240 m.

**Cambios.**

- **Modelo y migración** (`20261001000001-modelo-territorial-direccion.js`): `departamento` (partido/comuna) y `nomenclatura` nuevas (nullable); `localidad` y `codigoPostal` opcionales. Nullable para no romper filas existentes.
- **`geolocation_service`**: filtros opcionales `departamento`/`localidad`; **deduplicación por identidad territorial** (provincia+departamento+localidad censal+calle: los segmentos de una misma calle no son ambigüedad); `DireccionAmbiguaError` con `opciones` agrupadas.
- **`direccion_service`**: **partido obligatorio cuando la provincia es Buenos Aires** (sobre datos combinados, cubre updates parciales); persistencia normalizada (`departamento`/`localidad`/`nomenclatura`); `CAMPOS_UBICACION` ampliado.
- **`error_handler`**: ambigua → **409 con opciones** (antes 422 seco). Cobertura sin cambios (`evaluarZona` ya comparaba `departamento`).
- Swagger, DER, modelo-dominio, reglas-negocio (§18 nueva), seeders con datos normalizados, tests.

**Verificación.** Suite completa en verde tras la iteración (408 tests de la época); lint y build limpios.

## Módulo 2 — Iteración 2: Normalización total con Georef al persistir

**Objetivo.** Eliminar el régimen híbrido "algunos campos del usuario, otros de Georef": la fila persistida debe reflejar **exactamente** la dirección resuelta.

**Cambios.**

- En `prepararDireccion`, la persistencia normalizada por Georef se amplió a **los cinco campos territoriales**: `provincia`, `calle`, `departamento` (partido/comuna), `localidad` (censal) y `nomenclatura` como **dato geográfico complementario**. La escritura original del usuario no se conserva (la forma oficial vive en `nomenclatura`).
- Display "tal cual" confirmado: las direcciones se muestran con los nombres oficiales de Georef (p. ej. "AV CORRIENTES 1234"); `nomenclatura` queda como referencia completa.
- Tests de expectativa ajustados (service, controllers, sucursal); docs actualizadas (§7/§14/§17, DER, modelo-dominio, informe).

**Verificación.** Suite completa en verde (408/408 de la época); lint 0; commit `8de4274`.

## Módulo 3 — Iteración 3: Cascada territorial, autocompletado y preview

**Objetivo.** Selects en cascada provincia → partido/comuna → localidad, autocompletado de calles, selección robusta de coincidencias ANTES de conectar con la cobertura definitiva, auto-completado de calle normalizada/localidad/coordenadas y aviso de cobertura al elegir provincia. Corrección de 3 bugs detectados en testeo manual.

**Cambios de fondo.**

- **Proxy con cache** (`geo_catalogo_service.js` + `routes/geo.js`, públicos): `/api/geo/departamentos` (partidos/comunas), `/api/geo/localidades` (**BAHRA**; en CABA son los barrios — la semántica del filtro real de `/api/direcciones`), `/api/geo/calles` (autocomplete ≥3 letras), `/api/geo/zonas` (misma config que la validación real) y **`POST /api/geo/preview`**: resuelve identidad SIN persistir ni validar cobertura (`resolverDireccion`, variante no-lanzante de la geocodificación con la misma deduplicación; 200 con `unica`/`ambigua`/`no_encontrada` y `opciones` que incluyen la **calle oficial** para un reintento determinista).
- **Frontend**: `useDireccionTerritorial.js` (lógica única compartida), `Autocomplete.jsx` (combobox), flujo **Verificar → opciones → confirmación → Guardar** (la cobertura definitiva recién al guardar, ya sin ambigüedad que la enmascare).
- **Fixes de los 3 bugs reportados** (causas verificadas): **A** — al elegir una opción se copiaba la localidad _censal_ al filtro BAHRA `localidad` (inexistente → 0 resultados → "no pudo ser ubicada"); solo se aplican el partido/comuna y la calle oficial. **B** — estado territorial oculto en CABA: partido/comuna siempre visible y cualquier edición invalida la resolución. **C** — congelamiento al eliminar dirección: try/finally + `ok?.ok` + confirmación inline en el modal (el ConfirmarModal apilado dejaba el backdrop trabado).

**Fixes post-testeo del autocompletado (4 bugs, causas verificadas contra el código y la API real).**

1. La búsqueda de calle fallaba en silencio al abrir el formulario (la query exige provincia; sin rama de error; sin cancelación de respuestas obsoletas) → calle deshabilitada hasta provincia con hint + `errorSugerencias` + flag `cancelado`.
2. Selects nativos incómodos → `Autocomplete` reutilizable (texto para buscar, lista filtrada y ordenada, **selección explícita válida**; el texto libre se descarta; validación de pertenencia en el hook).
3. Sugerencias indistinguibles (una misma calle existe en varias comunas con ids distintos) → etiqueta con `nomenclatura` ("AV JUAN B JUSTO, Comuna 9, CABA"); **ninguna opción legítima se deduplica**; test de contrato en `/api/geo/calles`.
4. Las sugerencias reaparecían tras seleccionar (la selección cambiaba `calle` y re-disparaba la búsqueda) → `calleSeleccionadaRef`: no se re-busca por el texto que produce la propia selección.

**Verificación.** +22 tests (catálogo, rutas geo, preview); suite en verde (430 de la época); builds y lint limpios; E2E manual del caso "juan b justo 4200".

## Módulo 4 — Iteración 4: AMBA completo y UX de formularios

**Objetivo.** Completar la cobertura geográfica a la definición INDEC del AMBA (CABA + **40 partidos**) y reordenar/presentar los formularios de general a específico.

**Cambios.**

- **Cobertura (solo configuración)**: `cobertura-zonas.js` pasa de 24 a los 40 partidos completos (los 16 agregados —Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Exaltación de la Cruz, General Las Heras, General Rodríguez, La Plata, Luján, Marcos Paz, Pilar, Presidente Perón, San Vicente, Zárate— verificados contra Georef). **No** se habilita toda la provincia (Bahía Blanca/General Pueyrredón siguen fuera). Regla conservada y hecha explícita en tests: zona habilita, **sucursal activa ≤5 km por ruta decide** — La Plata pasa de "fuera de zona" a "sin cobertura" cuando no hay sucursal cerca (cambio de mensaje, mismo resultado operativo).
- **UX**: orden Provincia → Partido/Comuna → Localidad → Calle → Altura → datos complementarios (el gate "calle espera provincia" fluye con el orden visual); secciones "Ubicación"/"Dirección"/complementarios; **componentes compartidos extraídos** (`OpcionesDireccionAmbigua`, `ConfirmacionDireccion`); **aviso por partido** usando los `departamentos` de `/api/geo/zonas`; CSS scoped con la identidad existente.
- Merge con el rediseño UI de dev (79 archivos): conflictos resueltos conservando el rework territorial y adoptando convenciones visuales (clases de ancho por CSS, `h3.h5`, `noValidate`, `role="alert"`).

**Verificación.** Tests de zona actualizados (La Plata dentro, Bahía Blanca fuera, Pilar dentro); suite en verde; builds y lint limpios.

## Módulo 5 — Iteración 5: Validación de cobertura y manejo de resultados

**Objetivo.** Conectar el formulario con las reglas **reales** de cobertura en el paso de verificación, y manejar todos los resultados con una taxonomía que distingue funcionales (bloquean) de técnicos/temporales (reintentan). El diseño final de mensajes quedó para la iteración 6.

**Cambios.**

- **Preview con flag opt-in `cobertura: true`** (solo el form del cliente): con resultado único, `data.cobertura` agrega el resultado **no lanzante** de `evaluarCoberturaCoordenadas` (zona → sucursal activa más cercana por ruta → `coberturaDisponible`; ORS solo si hay zona). Sin flag = comportamiento previo (admin: 0 llamadas a ORS). **El alta sigue siendo la validación definitiva.**
- **`error_handler`**: el 422 de "sin cobertura" expone `detalle.distanciaMasCercanaMetros` (antes se calculaba y se perdía).
- **Frontend**: threading de `status`/`detalle` por toda la cadena (`client.js` → `api/direcciones` → `DireccionContext`); taxonomía por status (funcional vs técnico con Reintentar); `guardando` (**anti doble-submit**: un doble click creaba dos direcciones); `bloqueadaPorCobertura` (el confirmar no procede). Admin sin cobertura comercial (regla conservada y testeada).
- **Fix post-iteración: 503 engañoso en el autocomplete con localidad seleccionada** (caso real: Merlo + Libertad + "mataco"). Causa verificada: `/api/calles` **no acepta** el filtro `localidad` (solo existe en `/api/direcciones`; sus filtros son `provincia`/`departamento`/`localidad_censal`) → Georef respondía 400 y el error handler lo traducía a "servicio no disponible". **No fue un rate limit** (las condiciones de Georef establecen que las cuotas abiertas sin autenticación "no están definidas"). Fix: no reenviar el filtro + tests de regresión que fijan la URL a Georef sin `localidad`.

**Verificación.** +5 tests de preview con BD real (cobertura disponible/fuera de zona sin ORS/sin cobertura/ORS caído/sin flag); assert del `detalle` en el controller; suite en verde (437 de la época); verificación del caso real a través del servicio compilado.

## Módulo 6 — Iteración 6: Presentación final de errores y confirmación de dirección

**Objetivo.** Cierre funcional y visual: presentación clara y diferenciada de todos los resultados, ficha de confirmación con los datos relevantes antes de guardar, y consistencia validación ↔ persistencia. **Backend sin cambios** (auditoría: respuestas completas tras la iteración 5).

**Cambios (todos frontend).**

- **Estado unificado `resultado { tipo, mensaje?, items?, detalle? }`** en el hook, con variantes `datos` / `cobertura-zona` / `cobertura-sucursal` / `tecnico` — reemplaza al trío errores+tipoError+bloqueo y elimina estados contradictorios o duplicados. Lógica intacta: invalidación por edición, guard anti doble-submit, `bloqueadaPorCobertura`.
- **`ResultadoDireccion.jsx`** (nuevo): presentación diferenciada por tipo — "Revisá los datos de la dirección" (correcciones), "Todavía no operamos en esa zona", "Sin cobertura por el momento" (**con la distancia de la sucursal activa más cercana**, del preview o del `detalle` del 422), "Servicio no disponible" + **Reintentar** (los técnicos jamás como "dirección inválida"). Muestra la nomenclatura resuelta como referencia.
- **`ConfirmacionDireccion` extendida**: ficha para revisar antes de guardar (Calle + Altura, Partido/Comuna, Localidad, Provincia, **CP solo si existe** — Georef no lo provee; en alta se omite — y Referencia solo si fue ingresada) + badge "✓ Dirección validada" + nomenclatura oficial + coordenadas + "Te atiende {sucursal} (X km por ruta)"; botones deshabilitados durante el guardado.
- **Formularios**: región de resultados con **`aria-live="polite"`**; admin con la misma presentación de estados, sin cobertura comercial. CSS de ficha/variantes con la identidad existente (responsive).

**Verificación.** Backend de regresión **439/439** + lint 0 (sin cambios); `vite build` OK; eslint de la lógica limpio.

## Verificación acumulada del feature

- **Backend**: 439/439 tests (28 suites, `--runInBand`, Node 14.15.5), `npm run lint` limpio, build Babel OK, verificaciones en vivo contra Georef/ORS documentadas por módulo.
- **Frontend**: `vite build` OK en cada iteración; eslint limpio en la lógica propia (hook/api/context); verificación manual E2E del flujo completo (cascada, autocomplete estable, desambiguación, bloqueo por cobertura, reintento técnico, doble submit, admin fuera de zona).
- **Reglas conservadas en todo el feature**: solo sucursales activas; distancia por ruta (ORS); límite de 5 km; zona habilita y sucursal decide; el alta re-valida todo; admin sin cobertura comercial; pedidos y asignación de sucursales intactos; Node 14 y lockfile v1 sin cambios de dependencias.

## Fuentes consolidadas (archivos reemplazados por este informe)

- `informe-iteracion1-geo-direcciones.md` (iteración 1; contenía también la enmienda de la iteración 2)
- `informe-iteracion3-geo-cascada-preview.md` (iteración 3 + fixes del autocompletado)
- `informe-iteracion4-geo-amba-ux.md` (iteración 4)
- `informe-iteracion5-geo-cobertura-resultados.md` (iteración 5 + fix 503)
- `informe-iteracion6-geo-presentacion-final.md` (iteración 6)
