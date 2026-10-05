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
│   ├─ geo_catalogo_service      direccion_controller                                │
│   ├─ geolocation_service           └─ direccion_service (orquestación del ABM)      │
│   │    (Georef Argentina)                ├─ geolocation_service (geocodificación)   │
│   └─ cobertura-zonas.js (config)         └─ cobertura_service                       │
│                                               ├─ evaluarZona (zonas config)         │
│   middlewares/error_handler.js                └─ routing_service (OpenRouteService)  │
│   (taxonomía de errores HTTP)               models/Direccion → PostgreSQL           │
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

### 4.2 Verificación (preview) y desambiguación

1. **Verificar** → `POST /api/geo/preview` `{ calle, altura, provincia, departamento?, localidad?, cobertura: true }` (CSRF como todo POST).
2. Backend (`routes/geo.js` → `geolocation_service.resolverDireccion`): query a Georef `/api/direcciones` → **0 resultados** → `no_encontrada`; **varias identidades territoriales** → `ambigua` con `opciones` (nomenclatura + calle oficial + territorio); **una identidad** → `unica` con `resultado` (lat/lon, nomenclatura, normalizada).
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

| Servicio               | Responsabilidad                                                                                                                                                                                                                                                                       | Detalles                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geo_catalogo_service` | Proxy con **cache en memoria** de Georef (24 h catálogos / 5 min autocomplete): departamentos, localidades BAHRA, calles, zonas.                                                                                                                                                      | Reutiliza `llamarGeoref`; `GET /api/geo/zonas` deriva de `cobertura-zonas.js` (misma fuente que la validación).                                                                                                                                              |
| `geolocation_service`  | Comunicación con Georef + interpretación: `geocodificarDireccion` (lanzante: errores tipados), `resolverDireccion` (no-lanzante para el preview), `buscarDirecciones`, `llamarGeoref` genérica.                                                                                       | Query con filtros opcionales `departamento`/`localidad` (solo los que corresponden por endpoint); deduplicación por identidad territorial; `DireccionAmbiguaError` con `opciones` (incluye calle oficial); un intento sin retry (ToS), timeout configurable. |
| `direccion_service`    | Orquestación del ABM (usuario y sucursal): validación acumulada, regla PBA, geocodificación, persistencia **normalizada** (`CAMPOS_UBICACION` ampliado), cobertura solo para entrega.                                                                                                 | Errores tipados: `ErrorValidacionDireccion` (400).                                                                                                                                                                                                           |
| `cobertura_service`    | Reglas de cobertura: `evaluarZona` (pura, config), `obtenerSucursalesActivas` (BD), `evaluarCoberturaCoordenadas` (no-lanzante: zona + rutas), `validarCoberturaParaDelivery` (lanzante: `DireccionFueraDeZonaError` / `DireccionSinCoberturaError` con `distanciaMasCercanaMetros`). | Comparaciones insensibles a mayúsculas/acentos contra datos normalizados de Georef.                                                                                                                                                                          |
| `routing_service`      | Único punto de contacto con **ORS**: `calcularRuta({origen, destino}) → {distanciaMetros, duracionSegundos}`. Convierte `lat,lon → lon,lat`, key por header `Authorization`, errores tipados (`OrsError`, 401/429/404 específicos).                                                   | Abstracción para reemplazar el proveedor sin tocar la lógica de negocio.                                                                                                                                                                                     |

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
  routes/    geo.js(+test) · direcciones.js · index.js
  controllers/ direccion_controller(+test) · sucursal_controller(+test)
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
