# Flujo completo — Direcciones y Geolocalización de Comi-Rapi

Informe **completo** del flujo de la funcionalidad de direcciones y geolocalización, desde el frontend hasta el backend. Sintetiza y reemplaza la lectura transversal de los informes por tarea/iteración: `informe-georef.md`, `informe-ors.md`, `informe-cobertura-geografica.md`, `informe-abm-direccion-geolocalizada.md`, `informe-6.1-mensajes-seeds.md`, `informe-mejoras-detallado.md` (iteraciones 1–6, que reemplazó a los informes individuales) e `informe-swagger.md`. El resumen ejecutivo está en `flujo-direcciones-geolocalizacion-resumen.md`.

Reglas de negocio vigentes: `docs/reglas-negocio.md` (§7, §14–§19). Modelo: `docs/DER.md` §2.2.

## 1. Visión general

```
┌────────────────────────────── FRONTEND (React + Vite) ──────────────────────────────┐
│ Perfil.jsx (modal "Mis direcciones")                                                 │
│   └─ FormularioDireccion.jsx (o FormularioSucursal.jsx para admin)                  │
│        ├─ Autocomplete.jsx (provincia / partido-comuna / localidad)                 │
│        ├─ OpcionesDireccionAmbigua.jsx (radios de desambiguación)                   │
│        ├─ ConfirmacionDireccion.jsx (ficha validada + guardar)                      │
│        ├─ ResultadoDireccion.jsx (estados: datos / cobertura / técnico)              │
│        └─ useDireccionTerritorial.js  ← TODA la lógica del formulario               │
│             ├─ api/geo.js (catálogo + preview)      ├─ api/direcciones.js (ABM)     │
│             └─ api/client.js (fetch + cookie de sesión + CSRF doble envío)          │
│ DireccionContext.jsx (estado global de direcciones del cliente)                     │
└──────────────────────────────────────────────────────────────────────────────────────┘
                 │ /api/geo/* (catálogo, zonas, preview)      │ /api/direcciones (ABM)
┌────────────────────────────── BACKEND (Express + Sequelize, Node 14) ───────────────┐
│ routes/geo.js ─────────── routes/direcciones.js ──── (routes/sucursales.js)         │
│   ├─ geo_controller                  direccion_controller                             │
│   │    (valida y shapea)                 └─ direccion_service (orquestación ABM)   │
│   ├─ geo_catalogo_service                  ├─ geolocation_service (geocodificación)│
│   ├─ geolocation_service                   └─ cobertura_service                    │
│   │    (Georef Argentina)                       ├─ evaluarZona (zonas config)      │
│   └─ cobertura-zonas.js (config)               └─ routing_service (OpenRouteService)│
│   middlewares/error_handler.js          models/Direccion → PostgreSQL               │
│   (taxonomía de errores HTTP)                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Proveedores externos** (solo el backend los consulta, nunca el frontend):

- **Georef Argentina** (`https://apis.datos.gob.ar/georef`, pública, sin key, sin cuotas definidas): unidades territoriales oficiales (provincias, departamentos = partidos/comunas, localidades BAHRA, localidades censales) y geocodificación de direcciones.
- **OpenRouteService** (ORS, key gratuita en `.env.local`, nunca commiteada): distancia **real por ruta** entre coordenadas.

## 2. Reglas de negocio centrales

1. **Modelo territorial alineado con Georef**: `Direccion` persiste `provincia`, `calle`, `departamento` (partido en Buenos Aires / comuna en CABA / departamento en el resto), `localidad` (localidad censal) y `nomenclatura` (dirección completa normalizada) **todos normalizados por Georef** al geocodificar — la fila refleja exactamente la dirección resuelta. `codigoPostal` es opcional y queda null (Georef no provee códigos postales — verificado contra su API). Coordenadas `latitud`/`longitud` calculadas siempre por el backend (la API rechaza lat/lon manuales).
2. **Partido obligatorio en Buenos Aires**: en el ingreso, si la provincia es "Buenos Aires" el `departamento` es obligatorio (desambigua direcciones repetidas entre partidos — caso real: "General Villegas 5329" existe en Avellaneda y Tres de Febrero).
3. **Cobertura geográfica**: zona de operación = **CABA completa + los 40 partidos del AMBA** (definición INDEC, `lib/config/cobertura-zonas.js`; nombres verificados contra Georef). Partidos de la provincia fuera del AMBA (p. ej. Bahía Blanca) y otras provincias quedan fuera.
4. **Zona habilita, sucursal decide**: pertenecer a la zona **no** alcanza: debe existir una **sucursal activa** a ≤ **5 km por ruta** (`COBERTURA_RADIO_MAX_KM`, distancia real calculada con ORS, nunca línea recta). Primero se evalúa la zona (sin gastar ORS si falla); luego las sucursales.
5. **El alta es la validación definitiva**: el preview del frontend es informativo; `POST /api/direcciones` re-geocodifica y re-valida cobertura antes de persistir. Nunca se confía en el cliente.
6. **Admin sin cobertura comercial**: las direcciones de sucursal se geocodifican obligatoriamente pero **no** se validan por zona/distancia — el administrador puede registrar sucursales donde todavía no se opera.
7. **Deduplicación por identidad territorial**: resultados de Georef que comparten (provincia + departamento + localidad censal + calle) son el mismo lugar (segmentos a pocos metros): se toma el primero. Solo identidades territoriales distintas generan ambigüedad.
8. **Compatibilidad de direcciones de clientes y sucursales**: la misma entidad `Direccion` y el mismo `direccion_service` sirven a ambos, con `exigirCobertura` según el caso.

## 3. Entidad y migración

- **Modelo** `lib/models/direccion.js` (tabla `Direcciones`): `id`, `usuarioId`/`sucursalId` (XOR por CHECK `CK_Direcciones_propietario`), `calle`, `altura`, `provincia` (NOT NULL), `departamento`, `localidad`, `codigoPostal`, `nomenclatura` (todos opcionales), `referencia`, `latitud`/`longitud` `DECIMAL(10,7)`, `alias`, `activa`.
- **Migración** `db/migrations/20261001000001-modelo-territorial-direccion.js`: agrega `departamento` y `nomenclatura`, retira NOT NULL de `localidad` y `codigoPostal`. Nullable para no romper filas existentes (se completan al editar; backfill pendiente opcional).
- Relaciones: `Usuario 1:N Direccion`, `Sucursal 1:1 Direccion` (FK `Direccion.sucursalId`).
- El snapshot del pedido (`Pedido`) copia los datos al confirmarse (pendiente alinear naming `ciudad`→`localidad`, otra etapa).

## 4. Flujo del cliente (alta/edición de dirección)

### 4.1 Formulario y cascada territorial

`useDireccionTerritorial` (única fuente de lógica, compartida por ambos formularios) maneja: provincia → partido/comuna → localidad → calle → altura, ordenados de general a específico (iteración 4), con:

- **Selects combobox** (`Autocomplete.jsx`): texto libre para **buscar**, filtrado client-side (insensible a mayúsculas/acentos), lista ordenada, **selección explícita** de una opción válida (el texto libre se descarta al salir del campo); validación de pertenencia a las listas como red de seguridad.
- **Autocompletado de calles** con debounce (300 ms) contra `GET /api/geo/calles` (solo desde 3 letras; requiere provincia; cancela respuestas obsoletas; al elegir una sugerencia no re-busca por el texto que ella misma produce). Las sugerencias se distinguen por comuna/partido mediante la `nomenclatura` de Georef (una misma calle existe en varias comunas con ids distintos).
- **Catálogos** vía proxy del backend (`GET /api/geo/departamentos|localidades`): departamentos (partidos/comunas) y localidades **BAHRA** (en CABA son los barrios — unidades que el usuario conoce y el filtro real de `/api/direcciones`). Semántica de filtros verificada: `/api/calles` solo acepta `provincia`/`departamento`/`localidad_censal` (el filtro `localidad` BAHRA existe solo en `/api/direcciones`; reenviarlo a calles producía un 400 de Georef traducido a 503 — fix post-iteración 5).
- **Avisos de zona**: al elegir provincia fuera de la zona (`GET /api/geo/zonas`, misma config que la validación real) o partido fuera del AMBA → aviso amarillo inmediato (informativo; el backend decide al guardar).

### 4.1.1 Sugerencias de los formularios: de dónde sale cada lista y cómo se cachea

Los "botones" de las listas de sugerencias **no son estáticos**: se renderizan desde el estado de React del hook `useDireccionTerritorial`, que se llena de distintas fuentes según el campo. Nunca se cachea nada en localStorage/sessionStorage; hay **dos capas de cache**: la del servidor (`geo_catalogo_service`, un `Map` en memoria con TTL por clave) y el estado de React del formulario (vive solo la sesión del form). El frontend **nunca** consulta a Georef directamente: todo pasa por el proxy del backend.

| Campo                | Origen de la lista                                                                                                         | ¿Cuándo se consulta?                                                                                             | Cache servidor (proxy)                                                                         | Cache cliente (form)                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Provincia**        | **Estática**: 24 nombres oficiales hardcodeados en `src/utils/territorio.js` (constante versionada con el repo; cero HTTP) | Nunca (ya está en el bundle)                                                                                     | No aplica                                                                                      | No aplica: la constante se importa directo                                                                    |
| **Partido / Comuna** | `GET /api/geo/departamentos?provincia=` → Georef `/api/departamentos`                                                      | Al elegir la provincia (una vez por sesión del form)                                                             | `Map` en memoria, TTL **24 h**, clave por provincia (los datos territoriales casi no cambian)  | Estado de React del hook (`departamentosOpts`); se refetchea solo si cambia la provincia                      |
| **Localidad**        | `GET /api/geo/localidades?provincia=&departamento=` → Georef `/api/localidades` (BAHRA; barrios en CABA)                   | Al elegir provincia o partido                                                                                    | TTL **24 h**, clave por (provincia, partido)                                                   | Estado de React (`localidadesOpts`); invalidado al cambiar provincia/partido                                  |
| **Calle**            | `GET /api/geo/calles?...&nombre=` → Georef `/api/calles`                                                                   | **En vivo**, con **debounce de 300 ms** y solo desde 3 letras; cada pausa de tipeo dispara una consulta al proxy | TTL **5 min**, clave por (provincia, partido, prefijo) — el usuario repite prefijos al teclear | **Sin cache en el cliente**: cada pausa consulta al proxy, que responde de su cache si el prefijo ya se buscó |

Comportamiento de cada lista al usarla:

- **Provincia/Partido/Localidad (combobox `Autocomplete.jsx`)**: el texto tipeado **solo filtra** la lista client-side (comparación insensible a mayúsculas/acentos, orden alfabético); la selección es **explícita** — solo un click (o Enter sobre la primera coincidencia) fija el valor; si el usuario escribe algo y sale del campo sin elegir, **el texto libre se descarta** (se restaura el último valor confirmado). Al cambiar un campo padre se limpia el hijo (provincia → limpia partido y localidad; partido → limpia localidad).
- **Calle (autocomplete vivo)**: cada ítem de la lista muestra el **nombre oficial + `nomenclatura`** de Georef (para distinguir calles repetidas entre comunas/partidos — no se eliminan resultados legítimos); al hacer click se fija el nombre oficial y **no se re-dispara la búsqueda** por el texto que la propia selección escribió (`calleSeleccionadaRef` — fix del bug de la lista que se reabría); respuestas de consultas ya reemplazadas se **descartan** (flag `cancelado`); si el backend falla, el error es visible bajo el input (`errorSugerencias`) en lugar de fallar en silencio. La calle espera a la provincia: el input se deshabilita con un hint hasta elegirla.

### 4.2 Verificación (preview) y desambiguación

1. **Verificar** → `POST /api/geo/preview` `{ calle, altura, provincia, departamento?, localidad?, cobertura: true }` (CSRF como todo POST).
2. Backend (`geo_controller.preview` → `geolocation_service.resolverDireccion`): query a Georef `/api/direcciones` → **0 resultados** → `no_encontrada`; **varias identidades territoriales** → `ambigua` con `opciones` (nomenclatura + calle oficial + territorio); **una identidad** → `unica` con `resultado` (lat/lon, nomenclatura, normalizada).
3. Si `ambigua`: radios en el form; al elegir se aplican el `departamento` y la **calle oficial** de la opción (nunca la localidad censal como filtro BAHRA — fix de la iteración 3) y se re-verifica.
4. Si `unica` y `cobertura: true`: se agrega `data.cobertura` = resultado no-lanzante de `cobertura_service.evaluarCoberturaCoordenadas` (zona → sucursal activa más cercana por ruta → `coberturaDisponible`). ORS solo se consulta si hay zona.
5. El frontend muestra la **confirmación** (ficha con provincia/partido/localidad/calle+altura, CP solo si existe, referencia, badge de validación, sucursal que atiende y km por ruta) o el **estado de bloqueo** de cobertura. El guardado queda bloqueado sin cobertura.

### 4.3 Guardado

**Confirmar** → `POST /api/direcciones` (`direccion_controller.create` → `direccion_service.crearDireccionDeUsuario`, `exigirCobertura: true`):

```
validarDatosDireccion (400 acumulado) → regla partido-PBA (400)
→ geocodificarDireccion (Georef: 422 no encontrada / 409 ambigua con opciones / 503)
→ normalizar provincia/calle/departamento/localidad/nomenclatura (Georef)
→ validarCoberturaParaDelivery:
     evaluarZona → DireccionFueraDeZonaError → 422
     sucursales activas ≤5 km por ruta (ORS) → DireccionSinCoberturaError → 422 (con detalle.distanciaMasCercanaMetros)
→ Direccion.create (solo si todo pasa; coords + normalizados del backend)
```

- **Edición** (`PUT`): `CAMPOS_UBICACION` = calle, altura, provincia, departamento, localidad — si cambia alguno se re-geocodifica y re-valida; cambios de alias/referencia/CP no gastan proveedores; el payload idéntico reenviado no re-geocodifica.
- **Consistencia frontend**: cualquier edición de un dato de ubicación invalida la verificación previa (imposible guardar una dirección distinta de la validada); `guardando` impide el doble submit; los errores del guardado se clasifican por `status` (funcional vs técnico con Reintentar).

### 4.4 Baja lógica

`DELETE /api/direcciones/:id` → `activa = false` (solo el dueño). En `Perfil.jsx` la confirmación de borrado es inline dentro del modal (un modal apilado dejaba el backdrop trabado).

## 5. Flujo del administrador (sucursales)

`EditarSucursal.jsx → FormularioSucursal.jsx` (mismo hook y componentes; nombre de sucursal primero, luego horarios/teléfono/estado). El preview **sin** `cobertura` (0 llamadas a ORS). `POST/PUT /api/sucursales/:id` con `direccion` anidada → `direccion_service.prepararDireccion` con `exigirCobertura: false` → geocodificación obligatoria (sin coords la sucursal no sirve a la cobertura) **sin** validación de zona/distancia; la geocodificación ocurre antes de la transacción y la persistencia (sucursal + dirección) dentro, con rollback total ante fallo.

## 6. Backend — servicios

Qué hace cada service del feature, quién lo llama y qué NO hace (ninguno conoce HTTP salvo los que hablan con proveedores; los controllers traducen HTTP↔dominio):

| Servicio                   | Responsabilidad                                                                                                                                                                                                                                                          | Funciones públicas                                                                                                                                                                                                                                                 | Quién lo llama                                                                               | Qué NO hace                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`geo_catalogo_service`** | Proxy **con cache en memoria** (`Map` + TTL) del catálogo territorial de Georef: partidos/comunas, localidades BAHRA, calles y zonas de operación. Único punto de contacto del catálogo con Georef.                                                                      | `obtenerDepartamentos(provincia)`, `obtenerLocalidades({provincia, departamento})`, `buscarCalles({...nombre})`, `obtenerZonas()` (deriva de `cobertura-zonas.js`, sin HTTP), `limpiarCache()` (tests)                                                             | `geo_controller` (catálogo y autocomplete de los formularios)                                | No geocodifica direcciones, no valida cobertura, no toca la BD                                                                                                                            |
| **`geolocation_service`**  | Comunicación con Georef e **interpretación de resultados de direcciones**: construye la query (filtros opcionales según endpoint), deduplica por identidad territorial, normaliza y tipifica errores.                                                                    | `geocodificarDireccion` (lanzante: errores tipados 422/409/503), `resolverDireccion` (no-lanzante, para el preview: `unica`/`ambigua`/`no_encontrada`), `buscarDirecciones` (lista cruda), `llamarGeoref(ruta, campo)` (HTTP genérico reutilizado por el catálogo) | `geo_controller.preview`, `direccion_service` (geocodificación del ABM), `cobertura_service` | No persiste, no valida cobertura, sin retry (ToS de Georef; un intento con timeout configurable)                                                                                          |
| **`direccion_service`**    | **Orquestación del ABM** de `Direccion` (usuario y sucursal): valida y acumula errores de campo, aplica la regla partido-PBA, manda geocodificar, persiste TODO normalizado por Georef (provincia/calle/partido/localidad/nomenclatura) y exige cobertura según el caso. | `validarDatosDireccion`, `prepararDireccion` (valida+geocodifica+cobertura sin transacción), `crearDireccionDeUsuario`, `actualizarDireccionDeUsuario`, `persistirDireccionSucursal` (dentro de la transacción), `CAMPOS_UBICACION`                                | `direccion_controller` (cliente), `sucursal_controller` (admin)                              | No habla HTTP, no calcula distancias, no conoce las zonas (eso es cobertura_service)                                                                                                      |
| **`cobertura_service`**    | **Reglas de cobertura**: zona de operación (config `cobertura-zonas.js`, 40 partidos AMBA + CABA) y sucursal activa a ≤5 km **por ruta**.                                                                                                                                | `evaluarZona` (función pura), `obtenerSucursalesActivas` (BD), `evaluarCoberturaCoordenadas` (no-lanzante; usada por el preview con `cobertura`), `validarCoberturaParaDelivery` (lanzante; usada por el alta)                                                     | `direccion_service` (alta/edición), `geo_controller.preview` (evaluación informativa)        | No geocodifica (recibe coordenadas ya resueltas), no consulta ORS si la zona falla (zona primero)                                                                                         |
| **`routing_service`**      | Único punto de contacto con **OpenRouteService**: distancia y duración **reales por ruta** entre dos coordenadas.                                                                                                                                                        | `calcularRuta({origen, destino}) → {distanciaMetros, duracionSegundos, geometria}`                                                                                                                                                                                 | `cobertura_service` (distancias de cobertura)                                                | No conoce direcciones ni pedidos; abstracción para reemplazar el proveedor sin tocar la lógica de negocio. La `duracionSegundos` aún no tiene consumidor (futura base del ETA de pedidos) |

Los controllers del feature: **`geo_controller`** (catálogo + preview: valida parámetros → 400, llama services, shapea respuestas; refactor post-Tarea 7 que movió la lógica desde `routes/geo.js`) y **`direccion_controller`/`sucursal_controller`** (ABM delgado que delega en `direccion_service`). Contratos HTTP y interactivos: `docs/swagger.yml`, navegable en **`http://localhost:3000/api/docs`** (ver `docs/informe-swagger.md`).

## 7. Taxonomía de resultados HTTP (error_handler centralizado)

| Resultado                | HTTP                                      | Origen                                 | El frontend                           |
| ------------------------ | ----------------------------------------- | -------------------------------------- | ------------------------------------- |
| Alta/edición OK          | 200/201                                   | —                                      | Cierra y recarga direcciones          |
| Validación de datos      | 400                                       | `ErrorValidacionDireccion` / Sequelize | Pide corregir                         |
| Ambigua                  | **409** + `opciones`                      | `DireccionAmbiguaError`                | Radios de selección y re-verificación |
| No encontrada            | 422                                       | `DireccionNoEncontradaError`           | Pide revisar datos                    |
| Fuera de zona            | 422                                       | `DireccionFueraDeZonaError`            | Informa zona no habilitada            |
| Sin sucursal ≤5 km       | 422 + `detalle.distanciaMasCercanaMetros` | `DireccionSinCoberturaError`           | Informa cobertura; muestra distancia  |
| Georef/ORS indisponibles | **503**                                   | `GeorefError` / `OrsError`             | Error técnico: **Reintentar**         |
| Inesperado               | 500                                       | fallback                               | Error técnico                         |

Preview (`POST /api/geo/preview`): siempre 200 con `{ estado: 'unica'|'ambigua'|'no_encontrada', resultado?, opciones?, cobertura? }` — la ambigüedad y la cobertura se resuelven ANTES de guardar. 400 por faltantes; 503 ante caída de proveedores.

## 8. Configuración

```bash
GEOREF_BASE_URL=https://apis.datos.gob.ar/georef   GEOREF_TIMEOUT_MS=5000   GEOREF_MAX_RESULTADOS=10
ORS_API_KEY=(en .env.local, gitignored)            ORS_BASE_URL=https://api.openrouteservice.org
ORS_TIMEOUT_MS=5000                               ORS_PROFILE=driving-car
COBERTURA_RADIO_MAX_KM=5                           # zonas: lib/config/cobertura-zonas.js
```

## 9. Seeds y pruebas

- **Seeders** geocodifican con el mismo servicio transpilado (`db/seeders/utils/utils-georef.js` → `dist/`): sucursales (Morón con `departamento`, Palermo) y dirección demo del cliente, persistiendo los datos **normalizados**; fallan (sin insertar nada) si Georef no encuentra o hay ambigüedad.
- **Tests del feature** (suite backend: **439/439**, 28 suites, `--runInBand`, Node 14.15.5): geolocation (filtros, dedupe, opciones, errores), geo_catalogo (mapeo, cache, no-reenvío de `localidad` a `/api/calles`), rutas `/api/geo` (públicas, preview con/sin cobertura, conteo de llamadas ORS), cobertura (zona, 40 partidos, distancias, errores tipados), direccion_service (regla PBA, normalización, persistencia), controllers (201/400/409/422+detalle/503, permisos), routing (ORS mockeado).
- **Verificación manual** del frontend (sin framework de tests): cascada, autocomplete, desambiguación, bloqueo por cobertura, reintento técnico, doble submit, admin fuera de zona.

## 10. Mapa de archivos

```
BACKEND
  config/    cobertura-zonas.js (40 partidos AMBA) · config.js (georef/ors/cobertura)
  models/    direccion.js (+ direccion.test.js)
  services/  geolocation_service(+test) · geo_catalogo_service(+test) · direccion_service(+test)
             cobertura_service(+test) · routing_service(+test)
  routes/    geo.js (delgado: declara endpoints) · direcciones.js · index.js
  controllers/ geo_controller(+test) · direccion_controller(+test) · sucursal_controller(+test)
  middlewares/ error_handler.js (taxonomía HTTP)
  migrations/ 20261001000001-modelo-territorial-direccion.js
  seeders/   20260915000001-estados-pedido-sucursales · 20260915000002-direccion-cliente-demo · utils/utils-georef.js
FRONTEND
  api/       client.js (CSRF/credenciales) · geo.js · direcciones.js · sucursales.js
  hooks/     useDireccionTerritorial.js
  components/comunes/  Autocomplete.jsx · OpcionesDireccionAmbigua.jsx
                       ConfirmacionDireccion.jsx · ResultadoDireccion.jsx · DireccionFormulario.css
  components/cliente/  FormularioDireccion.jsx (+FormularioDireccion.css)
  components/admin/    FormularioSucursal.jsx
  context/   DireccionContext.jsx · SucursalContext.jsx
  pages/     cliente/Perfil.jsx · admin/EditarSucursal.jsx
  utils/     territorio.js (24 provincias estáticas) · direccion.js
```
