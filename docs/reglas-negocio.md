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
- **Campos obligatorios** al ingresar una dirección (cliente y admin, en la creación de la sucursal): `calle`, `altura`, `provincia`, `localidad` y `codigoPostal`. Se validan en la API y a nivel de modelo (`NOT NULL`).
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
  - `geocodificarDireccion({ calle, altura, provincia, localidad })` → `{ latitud, longitud, nomenclatura, normalizada: { calle, provincia, departamento, localidad } }`.
  - `buscarDirecciones({ ... })` → lista cruda de resultados (para desambiguación futura).
- **Fuente de datos**: los datos obligatorios de `Direccion` (`calle`, `altura`, `provincia`, `localidad`) se envían a Georef como query; `codigoPostal` no se usa en la query (Georef no lo admite en el endpoint `direcciones`).
- **Persistencia**: solo `latitud`/`longitud` se persistirán en `Direccion` (tarea futura de integración con el ABM). Los datos normalizados (`nomenclatura`, `provincia`, `localidad` de Georef) se devuelven pero no se persisten en esta etapa.
- **Errores tipados**:
  - `GeorefError`: errores HTTP (4xx/5xx), de conexión/timeout o respuesta inválida/incompleta.
  - `DireccionNoEncontradaError`: la dirección no fue encontrada (`total = 0`).
  - `DireccionAmbiguaError`: más de un resultado; incluye `resultados` para que la tarea posterior decida (no se elige automáticamente).
- **Políticas**: un solo intento sin retry (ToS de Georef), timeout configurable (`GEOREF_TIMEOUT_MS`), `User-Agent` de identificación del backend.
- **Configuración**: `GEOREF_BASE_URL`, `GEOREF_TIMEOUT_MS`, `GEOREF_MAX_RESULTADOS` (sin secretos). Bloque `georef` en `lib/config/config.js`.
- **Fuera de alcance actual**: OSRM, cálculo de distancias/rutas, integración con el ABM de `Direccion`, endpoints nuevos. La cobertura que consume este servicio está implementada (ver §16).

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
- **Definición adoptada de AMBA** (documentada explícitamente): la documentación del proyecto no definía la zona de operación, por lo que se adopta la definición oficial del AMBA / Región Metropolitana de Buenos Aires (INDEC): CABA + la totalidad de los 40 partidos bonaerenses que la rodean. En esta etapa la configuración incluye **CABA** (provincia completa) y los partidos del **primer y segundo cordón del conurbano**: Almirante Brown, Avellaneda, Berazategui, Esteban Echeverría, Ezeiza, Florencio Varela, General San Martín, Hurlingham, Ituzaingó, José C. Paz, La Matanza, Lanús, Lomas de Zamora, Malvinas Argentinas, Merlo, Moreno, Morón, Quilmes, San Fernando, San Isidro, San Miguel, Tigre, Tres de Febrero y Vicente López. Los partidos restantes del AMBA (Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Exaltación de la Cruz, General Las Heras, General Rodríguez, La Plata, Luján, Marcos Paz, Pilar, Presidente Perón, San Vicente, Zárate) pueden agregarse a la lista sin tocar el servicio.
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
- **Re-geocodificación en actualización**: `CAMPOS_UBICACION` (`calle`, `altura`, `provincia`, `localidad`) — si cambia alguno, se vuelve a geocodificar (y re-validar cobertura en el flujo de usuario) y se actualizan las coordenadas. `codigoPostal` NO dispara re-geocodificación (Georef no lo usa en la query). Cambios solo en `alias`/`referencia` (o payload idéntico reenviado por el frontend): se actualiza **sin llamar a proveedores externos**; la detección compara los datos enviados contra los persistidos.
- **Errores tipados del ABM** (en `cobertura_service` / `direccion_service`):
  - `ErrorValidacionDireccion`: datos de entrada inválidos/insuficientes → HTTP 400.
  - `DireccionNoEncontradaError` / `DireccionAmbiguaError`: no pudo ubicarse → HTTP 422 (mensaje amigable, sin detalles del proveedor).
  - `DireccionFueraDeZonaError` / `DireccionSinCoberturaError`: cobertura incumplida → HTTP 422.
  - `GeorefError`: indisponibilidad/timeout/conexión → HTTP 503.
  - `OrsError` (y subclases, incluida `CredencialesInvalidasError`): indisponibilidad/falla de infraestructura → HTTP 503. Una caída de un proveedor externo nunca se traduce en 422.
- **Fuera de alcance actual**: ETA, asignación de sucursal por stock, pagos, pedidos, ABM de zonas geográficas.
