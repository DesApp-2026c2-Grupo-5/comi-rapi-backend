# Reglas de negocio — Comi-Rapi

Documento de apoyo para implementar la capa `services`. Extrae las reglas que se desprenden del modelo aprobado. No introduce reglas nuevas.

Fuentes: `docs/enunciado.md`, `docs/modelo-dominio.md`, `docs/DER.md`, `AGENTS.md`.

## 1. Usuarios y roles

- Existe una única entidad `Usuario`; `email` es único.
- El modelo actual contempla únicamente los roles `CLIENTE` y `ADMINISTRADOR`.
- Las funcionalidades y entidades adicionales de Propuesta 2 no forman parte de la implementación actual y quedan fuera del modelo definido para esta etapa, sin plantearlo como una exclusión permanente de futuras ampliaciones.
- El sistema nace con un administrador inicial; los administradores pueden crear otros administradores.
- `Usuario` posee `fechaNacimiento` (atributo persistido). `edad` se obtiene a partir de `fechaNacimiento` y **no** se almacena como dato persistido.

## 2. Catálogo y productos

- `Categoria 1:N Producto`; el `nombre` de categoría es único; sin jerarquía de categorías.
- `Producto` tiene precio vigente, imagen, descripción, categoría, estado (`activo`) y `tipo` (`PRODUCTO` | `COMBO`).
- El precio del producto es el vigente; el precio histórico de un pedido no se reconstruye desde `Producto`.

## 3. Combos

- Un combo es un `Producto` con `tipo = COMBO`; no existe entidad `Combo` separada.
- La composición se modela con `ComboComponente` (`comboId`, `productoId`, `cantidad`).
- El combo tiene precio propio en `Producto.precio`; no se calcula sumando los precios actuales de sus componentes.

## 4. Personalización

- Se modela con `OpcionGrupo`, `Opcion` y `ProductoOpcionGrupo`.
- `OpcionGrupo` define nombre, `tipoSeleccion` (`UNICA`/`MULTIPLE`), `minimo`, `maximo`, `obligatorio` y `activo`.
- `Opcion` pertenece a un grupo y tiene nombre, `precioAdicional`, `activo` y `productoReferenciaId` opcional.
- Distintos productos pueden tener distintos grupos de personalización.
- Las opciones pueden tener precio adicional y estar activas/inactivas.
- Los límites de selección se establecen por grupo mediante `minimo`/`maximo`.

## 5. Stock y sucursales

- El stock es por `Sucursal + Producto`; la combinación (`sucursalId`, `productoId`) es única.
- `cantidad = 0` significa producto ofrecido pero sin stock.
- `disponible = false` significa que la sucursal no ofrece actualmente ese producto.
- No todos los productos están disponibles en todas las sucursales.
- Al confirmar un pedido se debe verificar la disponibilidad correspondiente.
- Pendiente de definición: cómo se verifica el stock de un combo cuya disponibilidad depende de sus componentes. No agregar una entidad para resolverlo.

## 6. Asignación de sucursal

Regla de negocio, no entidad:

1. Obtener sucursales activas.
2. Ordenarlas por proximidad geográfica a la dirección de entrega.
3. Verificar stock de la más cercana.
4. Si no puede satisfacer el pedido, probar la siguiente.
5. Repetir hasta encontrar una sucursal capaz de cumplirlo.
6. Si ninguna puede, el pedido no se confirma.

- Un administrador puede reasignar manualmente la sucursal de un pedido como excepción operativa.

## 7. Direcciones

- `Direccion` es la única entidad que almacena los datos de ubicación (domicilio textual y geolocalización latitud/longitud), tanto para usuarios como para sucursales.
- `Usuario 1:N Direccion`: un usuario puede tener muchas direcciones.
- `Sucursal 1:1 Direccion`: cada sucursal tiene exactamente una dirección (FK `Direccion.sucursalId`). `Sucursal` ya no almacena `direccion` como string ni coordenadas propias.
- Una dirección pertenece a un usuario o a una sucursal, nunca a ambos simultáneamente ni a ninguno. Se garantiza a nivel de persistencia mediante el CHECK `CK_Direcciones_propietario`.

> **Nota de cambio (Iteración 1-geo):** el ingreso de direcciones cambió al modelo territorial de Georef. Campos obligatorios: `calle`, `altura` y `provincia`. El `departamento` (partido) es obligatorio **solo** cuando la provincia es Buenos Aires (desambigua direcciones repetidas entre partidos). `localidad` y `codigoPostal` son opcionales: el backend determina la localidad a partir de la `localidad_censal` de Georef y el código postal ya no se exige porque **Georef no lo provee** (verificado contra su API). El backend persiste `provincia`, `calle`, `departamento`, `localidad` y `nomenclatura` normalizados por Georef (ampliado en Iteración 2; ver §17). Ver §14 y §18.

- **Coordenadas no manuales**: `latitud`/`longitud` son opcionales y **no se ingresan manualmente** (ni por el admin ni por nadie): la API las rechaza. El backend las calcula mediante `geolocation_service` (Georef) al crear/editar la dirección y las persiste. Ver §17.
- **ABM integrado con geolocalización/cobertura**: la creación y actualización de direcciones (usuario y sucursal) pasan por `direccion_service` (validación → Georef → zona/cobertura según corresponda → persistencia). Ver §17.
- La dirección de un usuario se gestiona mediante la API de direcciones; la dirección de una sucursal se gestiona mediante la API de sucursales (como objeto `direccion` anidado).
- La dirección puede modificarse o eliminarse tras un pedido.
- El pedido conserva un snapshot de la dirección al generarse/confirmarse: calle, altura, ciudad, codigoPostal, referencia, latitud y longitud.

## 8. Pedidos

- Al confirmar se registran usuario, sucursal asignada, dirección (snapshot), fecha/hora, detalle de productos, total y estado inicial.
- Al confirmar se revalidan las condiciones relevantes.
- El carrito es temporal y no se persiste.
- `Pedido` conserva `costoEnvio`, `total`, `medioPago`, `observacion` y el snapshot de dirección.
- La implementación actual simula el medio de pago.
- Pendiente de definición: valores definitivos de `medioPago`. Los valores utilizados actualmente son `MERCADO_PAGO` y `TARJETA`.

## 9. Estados e historial

- Estados previstos: `PENDIENTE`, `CONFIRMADO`, `EN_PREPARACION`, `LISTO`, `EN_CAMINO`, `ENTREGADO`, `CANCELADO`.
- `Pedido.estadoId` representa el estado actual.
- `PedidoEstadoHistorial` conserva la trazabilidad mediante estado, fecha/hora, usuario y observación.
- Cada cambio de estado debe actualizar `Pedido.estadoId` y generar simultáneamente un registro en `PedidoEstadoHistorial`.
- Pendiente de definición: reglas específicas de transición entre estados.

## 10. Snapshots históricos

- `PedidoItem` conserva `nombreProducto` y `precioUnitario`.
- `PedidoItemOpcion` conserva `nombre` y `precioAdicional`.
- `PedidoPromocion` conserva `descuentoAplicado`.
- Un pedido histórico debe mostrar los valores correspondientes al momento de la compra aunque posteriormente cambien productos, precios u opciones.

## 11. Promociones

- `Promocion` contempla inicialmente los tipos `DESCUENTO_PORCENTUAL` y `DOS_POR_UNO`.
- Existe relación N:M entre `Promocion` y `Producto` mediante `PromocionProducto`.
- Los combos, al ser productos, también pueden ser alcanzados por una promoción.
- `PedidoPromocion` registra la promoción aplicada a un pedido y conserva `descuentoAplicado` como snapshot.
- Pendiente de definición: dominio del campo `valor` de la promoción.
- No implementar ni documentar un motor genérico de reglas de promoción.

## 12. Parámetros del sistema

- `ParametroSistema` guarda configuraciones generales mediante `clave` única, `valor` y `descripcion`.
- No existen entidades específicas por parámetro.
- Pendiente de definición: cálculo del tiempo estimado de entrega (ETA). Puede definirse como una regla dinámica a partir del estado y/o parámetros, sin requerir necesariamente persistencia.

## 13. Reglas pendientes de definición

1. Verificación de stock de combos.
2. Valores definitivos de `medioPago`.
3. Dominio del `valor` de las promociones.
4. Cálculo del tiempo estimado de entrega (ETA).
5. Reglas de transición de estados.

## 14. Geolocalización (Georef Argentina)

- **Servicio de geocodificación**: `lib/services/geolocation_service.js` encapsula la comunicación con Georef Argentina (`https://apis.datos.gob.ar/georef`, API pública sin secretos). No contiene reglas de negocio ni integración con modelos/controllers.
- **API del servicio**:
  - `geocodificarDireccion({ calle, altura, provincia, departamento?, localidad? })` → `{ latitud, longitud, nomenclatura, normalizada: { calle, provincia, departamento, localidad } }`.
  - `buscarDirecciones({ ... })` → lista cruda de resultados (para desambiguación futura).
- **Fuente de datos**: `calle`, `altura` y `provincia` son los datos mínimos de la query; `departamento` y `localidad` se envían **solo si vienen informados** (filtros opcionales del endpoint `direcciones` de Georef); `codigoPostal` no se usa en la query (Georef no lo admite ni lo devuelve — verificado contra su API).
- **Interpretación de resultados (Iteración 1-geo)**: los resultados se **deduplican por identidad territorial** (provincia + departamento + localidad censal + calle). Una sola identidad no es ambigua aunque Georef devuelva varios segmentos de la misma calle (caso real verificado: "General Villegas 5329" en Tres de Febrero → 2 segmentos a ~240 m): se toma el primero (orden de relevancia de Georef).
- **Persistencia**: `direccion_service` persiste `latitud`/`longitud` y, desde la Iteración 1-geo (ampliado en la Iteración 2), también `provincia`, `calle`, `departamento`, `localidad` y `nomenclatura` normalizados por Georef (ver §17).
- **Errores tipados**:
  - `GeorefError`: errores HTTP (4xx/5xx), de conexión/timeout o respuesta inválida/incompleta.
  - `DireccionNoEncontradaError`: la dirección no fue encontrada (`total = 0`).
  - `DireccionAmbiguaError`: más de una identidad territorial; incluye `opciones` (agrupadas por identidad, sin coordenadas, para que el usuario elija) y `resultados` crudos para compatibilidad.
- **Políticas**: un solo intento sin retry (ToS de Georef), timeout configurable (`GEOREF_TIMEOUT_MS`), `User-Agent` de identificación del backend.
- **Configuración**: `GEOREF_BASE_URL`, `GEOREF_TIMEOUT_MS`, `GEOREF_MAX_RESULTADOS` (sin secretos). Bloque `georef` en `lib/config/config.js`.
- **Fuera de alcance actual**: OSRM, cálculo de distancias/rutas, endpoints nuevos. La cobertura y el ABM integrado que consumen este servicio están implementados (ver §16 y §17).

## 15. Cálculo de rutas (OpenRouteService)

- **Servicio de routing**: `lib/services/routing_service.js` encapsula la comunicación con OpenRouteService (ORS) y el cálculo de distancia/duración. No contiene reglas de negocio ni integración con modelos/controllers. Solo este archivo conoce al proveedor: en el futuro puede reemplazarse por OSRM u otro sin modificar la lógica de negocio.
- **Decisión de proveedor**: se evaluaron OSRM (autoalojado: mayor control pero agrega infraestructura/dataset/operación) y OpenRouteService (API externa con clave y cuotas, sin infraestructura propia). Se usa **OpenRouteService por ahora**, manteniendo la abstracción `RoutingService`.
- **API del servicio**:
  - `calcularRuta({ origen: { latitud, longitud }, destino: { latitud, longitud } })` → `{ distanciaMetros, duracionSegundos, geometria }`.
  - La geometría (polyline del trazado) se devuelve solo en la respuesta del servicio: no se persiste ni se integra con el frontend en esta etapa.
- **Solicitud**: `GET {ORS_BASE_URL}/v2/directions/driving-car?start=lon,lat&end=lon,lat`. ORS usa orden `lon,lat` (inverso a Georef `lat,lon`); el servicio convierte internamente. La API key se envía por header `Authorization`, **no** en la URL.
- **Errores tipados**:
  - `OrsError`: HTTP 400/5xx, conexión/timeout, respuesta inválida/incompleta.
  - `CredencialesInvalidasError`: API key ausente en config (sin llamar a ORS) o rechazada (401).
  - `LimiteSolicitudesError`: límite de solicitudes (429).
  - `RutaInexistenteError`: ORS no encontró una ruta (404).
- **Validación de entrada**: coordenadas presentes, numéricas y en rango (lat ±90, lon ±180); fallan sin llamar a la API.
- **Políticas**: un solo intento, sin retry ni cache (alcance académico); timeout configurable (`ORS_TIMEOUT_MS`).
- **Configuración**: `ORS_API_KEY` (clave gratuita del dashboard de HeiGIT), `ORS_BASE_URL`, `ORS_TIMEOUT_MS`, `ORS_PROFILE` (`driving-car`). Bloque `ors` en `lib/config/config.js`. **La clave nunca se commitea**: los `.env` versionados la dejan vacía y la clave real va en `.env.local` (gitignored), que gana sobre ellos (mecanismo de override en `initializeEnv`).
- **Fuera de alcance actual**: ABM de `Direccion`, frontend, ETA, infraestructura Docker para OSRM, cache/colas. La cobertura que consume este servicio está implementada (ver §16).

## 16. Cobertura geográfica (reglas de cobertura)

- **Servicio de reglas de negocio**: `lib/services/cobertura_service.js` determina si una dirección es válida para delivery. Reutiliza `geolocation_service` (dirección → coordenadas, Georef) y `routing_service` (coordenadas → distancia real por ruta, ORS) **sin duplicar su lógica**.
- **Reglas de negocio, no entidad**: no se creó ninguna entidad de zonas ni ABM. La cobertura se define en `services` según la arquitectura del proyecto.
- **Reglas en orden de evaluación**:
  1. La dirección debe geocodificarse (Georef, con los datos obligatorios `calle`, `altura`, `provincia`, `localidad`). Los errores tipados de Georef (`DireccionNoEncontradaError`, `DireccionAmbiguaError`, `GeorefError`) se propagan: una dirección no geocodificable no es válida para delivery.
  2. La dirección debe pertenecer a la **zona geográfica de operación**: se valida contra la configuración genérica de `lib/config/cobertura-zonas.js` usando los datos territoriales normalizados de Georef (`normalizada.provincia`, `normalizada.departamento`, `normalizada.localidad`). Si no pertenece a ninguna zona, la dirección no es válida y NO se consultan sucursales ni rutas.
  3. Debe existir al menos una **sucursal activa** con dirección geolocalizada dentro de la distancia máxima, medida como **distancia real por ruta** (no línea recta). Las sucursales inactivas o sin coordenadas se ignoran.
- **Distancia máxima**: 5 km inicial, configurable vía `COBERTURA_RADIO_MAX_KM` (bloque `cobertura` en `lib/config/config.js`). No hardcodeada.
- **Zonas de operación**: configuración genérica (estructura de datos, no lógica): cada zona define `provincias` (obligatorio) y listas opcionales de `departamentos`/`localidades`; comparación insensible a mayúsculas/minúsculas y acentos. Agregar o quitar zonas/partidos **no requiere modificar el servicio**: solo editar la configuración.
- **Definición adoptada de AMBA** (documentada explícitamente): la documentación del proyecto no definía la zona de operación, por lo que se adopta la definición oficial del AMBA / Región Metropolitana de Buenos Aires (INDEC): **CABA + la totalidad de los 40 partidos bonaerenses** que la rodean. **Iteración 4: la configuración incluye ahora los 40 partidos completos** (antes solo el primer y segundo cordón): Almirante Brown, Avellaneda, Berazategui, Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Esteban Echeverría, Exaltación de la Cruz, Ezeiza, Florencio Varela, General Las Heras, General Rodríguez, General San Martín, Hurlingham, Ituzaingó, José C. Paz, La Matanza, La Plata, Lanús, Lomas de Zamora, Luján, Malvinas Argentinas, Marcos Paz, Merlo, Moreno, Morón, Pilar, Presidente Perón, Quilmes, San Fernando, San Isidro, San Miguel, San Vicente, Tigre, Tres de Febrero, Vicente López y Zárate (nombres verificados contra los departamentos de Georef). Los partidos de la provincia **fuera** del AMBA (p. ej. Bahía Blanca, General Pueyrredón) siguen fuera de la zona: no se habilita la provincia completa.
- **Zona habilita, sucursal decide (sin cambios en la iteración 4):** pertenecer a una zona **no garantiza** el alta de la dirección: sigue siendo obligatorio que exista una sucursal activa a ≤ `COBERTURA_RADIO_MAX_KM` (5 km) **por ruta**. Consecuencia visible de la ampliación: direcciones de partidos del tercer cordón (antes rechazadas con `DireccionFueraDeZonaError`) pasan a evaluarse por cobertura de sucursales; si no hay ninguna cerca, se rechazan con `DireccionSinCoberturaError` (mensaje distinto, mismo resultado operativo).
- **API del servicio**:
  - `evaluarZona(normalizada, zonas)` → zona coincidente | null (función pura).
  - `obtenerSucursalesActivas()` → sucursales activas con dirección geolocalizada (de la BD).
  - `evaluarCoberturaCoordenadas({ coordenadas, normalizada, sucursales })` → resultado detallado, evaluando zona + rutas sobre coordenadas **ya geocodificadas** (permite reutilizar la geocodificación del llamador sin una segunda llamada a Georef).
  - `validarCoberturaDireccion({ direccion, sucursales = null })` → `{ dentroZona, zona, sucursal: { id, nombre, distanciaMetros } | null, coberturaDisponible, radioMaxKm, mensaje, coordenadas }`. La lista de sucursales puede inyectarse (útil para tests y reutilización); si no, se obtienen de la BD.
  - `validarCoberturaParaDelivery({ coordenadas, normalizada, sucursales })` → variante de validación del ABM: igual que `evaluarCoberturaCoordenadas`, pero lanza `DireccionFueraDeZonaError` / `DireccionSinCoberturaError` si la dirección no es válida para delivery.
- **Resultado**: objeto detallado; **no** se lanza un error por regla de negocio incumplida (quien lo consuma decide cómo tratarlo). Los errores de infraestructura de Georef/ORS sí se propagan. La variante del ABM (`validarCoberturaParaDelivery`) sí lanza los errores tipados.
- **Fuera de alcance actual**: frontend (el frontend no consume estas APIs directamente), endpoints de validación de pedido, ETA, costo de envío, asignación de sucursal por stock.

## 17. ABM de Direccion integrado (geolocalización + cobertura)

- **Servicio de orquestación**: `lib/services/direccion_service.js` concentra el flujo del ABM de `Direccion` (usuario y sucursal): validación de datos → geocodificación (Georef) → validación de zona/cobertura según corresponda → persistencia. Los controllers quedan delgados (traducen HTTP↔dominio) y los errores tipados se traducen a HTTP en el error handler.
- **Dirección de usuario (entrega)**: al crear/editar se geocodifica y se valida la cobertura (`validarCoberturaParaDelivery`): zona de operación + sucursal activa dentro del radio máximo por ruta. Si no supera las reglas, **la dirección no se persiste/no se actualiza nada**. Se reutiliza la geocodificación ya obtenida (sin segunda llamada a Georef).
- **Dirección de sucursal (origen)**: geocodificación **obligatoria** (una sucursal sin coordenadas no puede ser utilizada por `CoberturaService`); **sin** validación de zona/cobertura (la zona es una regla para direcciones de entrega). Si Georef falla, no se persiste nada.
- **Transacciones (sucursal)**: la llamada externa a Georef ocurre **antes** de iniciar la transacción; toda la persistencia (sucursal + dirección) se realiza dentro de la misma transacción: si falla cualquier operación, rollback y no queda nada parcial.
- **Re-geocodificación en actualización**: `CAMPOS_UBICACION` (`calle`, `altura`, `provincia`, `departamento`, `localidad`) — si cambia alguno, se vuelve a geocodificar (y re-validar cobertura en el flujo de usuario) y se actualizan las coordenadas. `codigoPostal` NO dispara re-geocodificación (Georef no lo usa en la query). Cambios solo en `alias`/`referencia` (o payload idéntico reenviado por el frontend): se actualiza **sin llamar a proveedores externos**; la detección compara los datos enviados contra los persistidos.
- **Regla territorial (Iteración 1-geo)**: en la provincia de Buenos Aires el `departamento` (partido) es **obligatorio** en el ingreso (regla verificada contra Georef: desambigua direcciones repetidas entre partidos). Se aplica sobre los datos combinados (cubre actualizaciones parciales que cambian la provincia) en `prepararDireccion`.
- **Persistencia normalizada (Iteración 1-geo, ampliada en Iteración 2)**: al geocodificar, `prepararDireccion` sobrescribe `provincia`, `departamento` (partido/comuna), `localidad` (localidad censal), `calle` y `nomenclatura` con los valores normalizados de Georef, **nunca** con el texto crudo del usuario. La `nomenclatura` se conserva como dato geográfico complementario (dirección completa normalizada); la escritura original del usuario no se persiste. La fila guardada refleja exactamente la dirección que Georef resolvió.
- **Errores tipados del ABM** (en `cobertura_service` / `direccion_service`):
  - `ErrorValidacionDireccion`: datos de entrada inválidos/insuficientes → HTTP 400.
  - `DireccionNoEncontradaError`: no pudo ubicarse → HTTP 422 (mensaje amigable, sin detalles del proveedor).
  - `DireccionAmbiguaError`: varias identidades territoriales → **HTTP 409 con `opciones`** (Iteración 1-geo; antes 422 sin opciones). El usuario elige una opción y reintenta con el `departamento` correspondiente (ver §18).
  - `DireccionFueraDeZonaError` / `DireccionSinCoberturaError`: cobertura incumplida → HTTP 422.
  - `GeorefError`: indisponibilidad/timeout/conexión → HTTP 503.
  - `OrsError` (y subclases, incluida `CredencialesInvalidasError`): indisponibilidad/falla de infraestructura → HTTP 503. Una caída de un proveedor externo nunca se traduce en 422.
- **Fuera de alcance actual**: ETA, asignación de sucursal por stock, pagos, pedidos, ABM de zonas geográficas.

## 18. Modelo territorial y desambiguación de direcciones (Iteración 1-geo)

> **Nota de cambio (Iteración 1-geo):** nueva sección que documenta el modelo territorial verificado contra Georef y el flujo de desambiguación. No se modifica cobertura (§16) ni ORS (§15).

- **Jerarquía territorial de Georef** (verificada contra su API y su documentación oficial):
  - `departamento` es la unidad intermedia universal: en Buenos Aires **es** el partido; en CABA son las **15 comunas** (Res. INDEC 55/2019; disponibles bajo `/departamentos`). El endpoint `/api/direcciones` lo acepta como filtro; **no** acepta `municipio` (HTTP 400).
  - En CABA la única `localidad_censal` es "Ciudad Autónoma de Buenos Aires" (sin valor discriminante) y **no existe endpoint de barrios**.
  - `localidades` (BAHRA) vs `localidades-censales` (INDEC): toda localidad pertenece a una localidad censal.
- **Representación adoptada**: un único campo `departamento` en `Direccion` que en PBA contiene el partido y en CABA la comuna. No se crean campos separados `partido`/`comuna` (no suman capacidad de desambiguación: el filtro de Georef es `departamento`) ni entidad territorial propia (la cobertura compara `departamento` contra `cobertura-zonas.js`, sin cambios).
- **Campos del usuario vs del backend**: el usuario ingresa provincia (select), partido (select, solo PBA), calle y altura; opcionalmente localidad. El backend obtiene de Georef: `departamento` normalizado (partido/comuna), `localidad` (localidad censal), `latitud`/`longitud` y `nomenclatura`. El **código postal ya no se pide**: Georef no lo provee y el proyecto no incorpora otros proveedores (queda null si nadie lo cargó).
- **Flujo de desambiguación (409)**: POST/PUT con varias identidades territoriales → **409** con `opciones: [{ nomenclatura, provincia, departamento, localidad }]` (sin coordenadas) → el frontend muestra las opciones → el usuario elige → se reintenta el mismo request agregando el `departamento` de la opción elegida → identidad única (o segmentos de la misma identidad, que no son ambiguos) → se resuelve normalmente. No requiere endpoints nuevos ni autocomplete.
- **Fuera de alcance actual**: autocomplete de calles, proxy de listas territoriales (el select de partidos usa una lista estática versionada en el frontend), backfill de `departamento`/`nomenclatura` en filas existentes (se completan al editar la dirección).

## 19. Catálogo territorial y preview de direcciones (Iteración 3)

> **Nota de cambio (Iteración 3):** nueva sección. Proxy del catálogo territorial de Georef con cache, autocompletado de calles, aviso de cobertura por provincia y preview de direcciones. La cobertura (§16) y el flujo del ABM (§17) **no cambian**; el preview resuelve la ambigüedad ANTES de guardar (requisito: primero la selección, después la cobertura).

- **Por qué un proxy**: el frontend nunca llama a Georef directamente (regla del proyecto); las calles y localidades no pueden ser listas estáticas razonables; y los selects deben ofrecer los nombres oficiales con los que el backend consulta Georef (misma nomenclatura en todo el flujo). `lib/services/geo_catalogo_service.js` reutiliza la comunicación de `geolocation_service` (`llamarGeoref`) con **cache en memoria** (ToS de Georef): 24 h para catálogos casi estáticos (departamentos, localidades), 5 min para el autocompletado (prefijos repetidos).
- **Endpoints públicos** (`lib/routes/geo.js`):
  - `GET /api/geo/departamentos?provincia=` — partidos (Buenos Aires) / comunas (CABA).
  - `GET /api/geo/localidades?provincia=&departamento?=` — localidades **BAHRA** (en CABA son los barrios; misma semántica del filtro `localidad` de `/api/direcciones`).
  - `GET /api/geo/calles?provincia=&departamento?&localidad?&nombre=` — autocompletado (mínimo 3 letras: con menos, respuesta vacía sin consultar Georef).
  - `GET /api/geo/zonas` — zonas de operación derivadas de la MISMA configuración que usa `cobertura_service` (`cobertura-zonas.js`), para el aviso del frontend sin duplicar la fuente de verdad.
  - `POST /api/geo/preview` — geocodifica **sin persistir ni validar cobertura** (exige CSRF como todo POST). Devuelve siempre 200 con `{ estado }`: `unica` (resultado normalizado + nomenclatura), `ambigua` (opciones por identidad territorial, con la `calle` oficial para un reintento determinista) o `no_encontrada`. Implementado sobre `resolverDireccion` (`geolocation_service`), variante no-lanzante que reutiliza la deduplicación por identidad territorial.
- **Flujo del frontend (requisito de orden)**: verificar (preview) → resolver ambigüedad eligiendo una opción (aplica el `departamento` y la calle oficial; **nunca** la localidad censal, que no es un valor válido del filtro BAHRA) → confirmar los datos resueltos → recién entonces guardar; el POST de direcciones re-geocodifica y aplica la cobertura definitiva, sin que la ambigüedad la enmascare.
- **Validación de parámetros**: en la ruta (400 por provincia/nombre faltantes); errores de Georef → 503 centralizados en el error handler. Sin entidades, dependencias ni migraciones nuevas.
- **Correcciones de la iteración 3 (post-testeo manual)**: los ítems de `/api/geo/calles` se documentan con `departamento` y `nomenclatura` (vía `campos=estandar` de Georef) para **distinguir** calles repetidas entre comunas/partidos — no se deduplican: son tramos distintos con ids distintos (caso real: "AV JUAN B JUSTO" existe en 6 comunas de CABA). En el frontend, la búsqueda de calle espera a que la provincia esté seleccionada (la query la exige), descarta respuestas obsoletas, no re-busca por el texto que produce la propia selección (la lista ya no se reabre), y los campos territoriales usan un combobox (`Autocomplete`) con filtrado client-side de los catálogos ya cargados y **selección explícita de una opción válida** (el texto libre solo busca; no se acepta como valor).
