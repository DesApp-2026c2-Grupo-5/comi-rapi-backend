# Plan maestro — Funcionalidades pendientes de pedidos

Documento de planificación de referencia para las próximas iteraciones de trabajo: **asignación de sucursal, tiempo estimado de entrega (ETA), seguimiento del pedido y reasignación manual**. Fuente de verdad funcional: `docs/enunciado.md`; auditoría de código: este documento; flujo del feature ya cerrado (direcciones/geolocalización): `docs/flujo-direcciones-geolocalizacion.md`.

---

## 1. Estado actual (auditoría verificada con archivo:línea)

| Frente                    | Estado real                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modelo de Pedido**      | `Pedido.sucursalId` NOT NULL (pedido.js:11-14); snapshot de dirección con columnas `latitud`/`longitud` **que el flujo web nunca puebla** (el front no las manda, api/pedidos.js:117-127). Sin campos de tiempo/ETA. `PedidoItem` (linea_pedido.js) y `PedidoEstadoHistorial` (historial_estado_pedido.js) con snapshot de producto y fechas por estado.                                                                                                   |
| **Creación del pedido**   | `pedido_controller.create` (384-477): transacción completa con validación de items contra catálogo, promociones con snapshot, estado inicial `pendiente` y primer registro de historial. **`resolverSucursal` (289-335)**: respeta la sucursal pedida si está activa y tiene stock; si no, `asignarSucursalOptima` (menor carga de pendientes **solo entre sucursales con stock**, asignacion_sucursal.js:8-27). **La distancia/cobertura NO interviene.** |
| **Stock**                 | PK (sucursalId, productoId) con `cantidad` y `disponible` (stock.js:24-44). Se descuenta **al crear** (reserva implícita atómica, stock.js:620-662), se re-verifica al confirmar el pago con **reasignación automática** si la reserva venció (pedido_controller.js:602-632), se repone al cancelar (655-663). Combos derivados de componentes (stock.js:43-57).                                                                                           |
| **ETA**                   | **No existe nada.** `routing_service.calcularRuta` ya devuelve `{distanciaMetros, duracionSegundos}` (routing_service.js:17) — hoy la duración se calcula y se descarta.                                                                                                                                                                                                                                                                                   |
| **Estados y seguimiento** | 7 estados con matriz de roles completa (estados_pedido.js:71-88). WebSocket `pedido_actualizado` único evento, sin polling (webSocketContext.md). Stepper con fechas por estado; **sin estimaciones en ninguna vista**.                                                                                                                                                                                                                                    |
| **Reasignación manual**   | **No existe**. Solo la automática por stock vencido al confirmar el pago. Sin endpoint ni UI.                                                                                                                                                                                                                                                                                                                                                              |
| **Docs previas**          | plan-etapa-pedidos.md y plan-estados-pedido.md: implementados completos y superados (el polling de 3s que describen ya no existe).                                                                                                                                                                                                                                                                                                                         |

## 2. Objetivos

1. **Selección de sucursal**: al crear el pedido, elegir **la sucursal más cercana por ruta que tenga stock suficiente, dentro de la cobertura** (≤5 km por ruta desde la dirección de entrega). Si ninguna cumple → rechazar con mensaje claro.
2. **Tiempo estimado de entrega (ETA)**: calcular al confirmar el pedido: **cocina (30 min fijos) + viaje (duración por ruta ORS)**. Persistirlo; recalcularlo si la sucursal cambia; degradar sin bloquear el pago si ORS falla.
3. **Seguimiento**: exponer y mostrar el ETA en el ciclo `confirmado → en_camino`; ocultarlo en estados finales y antes de confirmar. Sin GPS ni mapas.
4. **Reasignación manual**: permitir al admin reasignar el pedido a otra sucursal con las **mismas reglas** (activa + stock + cobertura), en estados no avanzados, con trazabilidad.

## 3. Decisiones cerradas (aprobadas por el equipo)

| #      | Decisión                                               | Detalle                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **La más cercana con stock** (reemplaza "menor carga") | Válida según `enunciado.md:58` (_"queda a criterio de cada grupo"_). Elegible = activa ∧ stock suficiente ∧ dentro de cobertura. Entre elegibles: **la más cercana por ruta** (si la primera no tiene stock, la siguiente). Ranking vacío → 422 "No hay sucursales disponibles con stock dentro de la cobertura". |
| **D2** | **El frontend NO pre-asigna sucursal**                 | Elimina el espejo (`asignacionSucursal.js` del front, `SucursalContext` con `sucursalAsignada`). El POST siempre asigna con las reglas reales; la respuesta trae la sucursal asignada. Menos duplicación, cero divergencias.                                                                                      |
| **D3** | **Cocina: 30 minutos fijos**                           | Constante en la config del backend (`config.pedidos.tiempoCocinaMin = 30`), documentada. Si a futuro se quiere dinámica: `ParametroSistema` (reglas-negocio §12).                                                                                                                                                 |
| **D4** | **Reasignación manual con las mismas reglas**          | El admin **no puede** asignar una sucursal fuera de cobertura. Estados habilitados: `pendiente`, `confirmado`, `en_preparacion`.                                                                                                                                                                                  |

## 4. Grafo de dependencias (con el prerrequisito transversal T0)

```
T0  Snapshot del pedido con coordenadas  ← TRANSVERSAL (hoy lat/lng quedan null)
     └─ sin coords no hay: distancia, cobertura en selección, ni ETA de viaje
T1 (M1) Selección de sucursal con cobertura   ← depende de T0
T2 (M2) ETA: modelo + cálculo                  ← depende de T0; PARALELA a T1
T3 (M3) Seguimiento con ETA (API + frontend)   ← depende de T2
T4 (M4) Reasignación manual (admin)           ← depende de T0 + T2
```

T1 y T2 son paralelizables; T3 es corta (puede agruparse con T2); T4 al final.

## 5. Division en tareas (referencia para los plannings individuales)

### T0 — Snapshot del pedido con coordenadas

- **Objetivo**: que `Pedido.latitud/longitud` se pueblen siempre al crear el pedido.
- **Alcance**: el front selecciona una `Direccion` en el checkout y envía `direccionId` en el payload; el backend lee la `Direccion` persistida (que ya pasó el ABM con geocodización obligatoria) y copia lat/lng al snapshot. Si la dirección no tiene coords → 422 (defensivo: no debería pasar).
- **Backend**: `pedido_controller.create` + `extraerDireccion` extendida. **Frontend**: `api/pedidos.js` (`payloadBackend` agrega `direccionId`), `Carrito.jsx` (envía el id de la dirección seleccionada). **Modelo**: sin cambios (columnas existen).
- **Pruebas**: controller test del POST con direccionId → snapshot con coords; sin direccionId o sin coords → 422/400.
- **Resultado esperado**: todo pedido nuevo tiene coordenadas de entrega persistidas.

### T1 — Selección de sucursal con cobertura y stock (M1)

- **Objetivo**: reemplazar `resolverSucursal` por la regla D1.
- **Alcance**: nuevo `seleccion_sucursal_service.js` (o extensión de `asignacion_sucursal.js`): recibe los items del pedido + las coords de entrega → usa `evaluarCoberturaCoordenadas` (que ya ordena sucursales por distancia de ruta) → filtra por stock suficiente (usa `faltantesDePedido` del stock_service) → devuelve la **más cercana con stock**. El controller delega. **Elimina el espejo del frontend** (D2): `Carrito.jsx` deja de pre-asignar; `ConfirmacionPedido.jsx` muestra la sucursal de la respuesta. **El POST cambia de contrato**: nuevo 422 "No hay sucursales disponibles con stock dentro de la cobertura" cuando el ranking queda vacío (antes creaba el pedido con stock fuera de cobertura).
- **Casos límite (enunciado)**: ninguna elegible → 422 con motivo; única elegible → esa; varias → la más cercana; más cerca sin stock → descartada (stock hard); con stock fuera de cobertura → descartada (cobertura hard).
- **Backend**: nuevo service + refactor de `resolverSucursal`. **Frontend**: Carrito/Confirmacion sin pre-asignación + manejo del 422. **Modelo**: sin cambios.
- **Pruebas**: unit tests del service (todos los casos límite, con ORS mockeado); controller tests del POST con/sin elegibles.
- **Resultado esperado**: todo pedido se sirve desde la sucursal más cercana con stock dentro de cobertura.

### T2 — ETA: modelo y cálculo (M2)

- **Objetivo**: persistir el tiempo estimado al confirmar.
- **Alcance**: **migración** `Pedido.etaMinutos INTEGER NULL` + `etaCalculadoEn DATE NULL`. Cálculo en el flujo de confirmación (`pendiente→confirmado`, pedido_controller.js:583-590): cocina (30, de config) + viaje (ORS `duracionSegundos` de la sucursal asignada a las coords del snapshot, vía `calcularRuta`). Si ORS falla → `etaMinutos` queda null (el pedido se confirma igual; log del error). La reasignación automática por stock vencido recalcula el ETA con la nueva sucursal.
- **Backend**: migración + models/pedido.js + `eta_service.js` (o método en el controller) + config. **Frontend**: sin cambios en esta tarea. **Modelo**: **CAMBIO** (migración sobre `Pedidos`).
- **Pruebas**: service tests (cocina+viaje, ORS caído → null, recálculo).
- **Resultado esperado**: todo pedido confirmado tiene `etaMinutos` o null si ORS falló.

### T3 — Seguimiento con ETA (M3)

- **Objetivo**: exponer y mostrar el ETA.
- **Alcance**: serialización del pedido agrega `etaMinutos` + `etaCalculadoEn` (GET /pedidos, GET /:id). **Frontend**: `DetallePedido.jsx` y `ConfirmacionPedido.jsx` muestran "Tiempo estimado: ~X min" cuando el estado ∈ {confirmado, en_preparacion, listo_para_entregar, en_camino} y etaMinutos ≠ null; ocultan en `entregado`/`cancelado`; nada antes de confirmar (no hay ETA). `MisPedidos.jsx` puede mostrarlo compacto en la tarjeta.
- **Backend**: serializer. **Frontend**: 2-3 componentes. **Modelo**: sin cambios adicionales.
- **Pruebas**: serializer test + verificación manual.
- **Resultado esperado**: el cliente ve el tiempo estimado desde la confirmación hasta que sale en camino.

### T4 — Reasignación manual de sucursal (M4)

- **Objetivo**: endpoint admin para reasignar con validaciones completas.
- **Alcance**: `PATCH /api/pedidos/:id/sucursal` (solo ADMIN; estados `pendiente|confirmado|en_preparacion`). Validaciones: nueva sucursal activa ∧ stock suficiente (transferir reserva en transacción: reponer vieja + descontar nueva, como la automática existente) ∧ dentro de cobertura (≤5 km por ruta desde las coords del snapshot). Recalcular el ETA con la nueva sucursal. **Trazabilidad**: `PedidoEstadoHistorial` con observación "Reasignado de {X} a {Y} por admin {Z}" (sin tabla nueva). **Frontend**: botón "Reasignar sucursal" en el panel admin de pedidos con selector de sucursales validadas por el backend.
- **Backend**: controller + service. **Frontend**: PedidosPendientes. **Modelo**: sin cambios.
- **Pruebas**: controller tests (permisos, estados válidos, stock insuficiente → 409, fuera de cobertura → 422, transferencia atómica con rollback).
- **Resultado esperado**: el admin reasigna pedidos tempranos a sucursales válidas, con ETA recalculado y trazabilidad.

## 6. Supuestos y riesgos señalados

| #   | Supuesto/riesgo                                                                                                       | Mitigación                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **Contrato del POST cambia**: pedidos que antes se creaban con stock fuera de cobertura ahora se rechazan (nuevo 422) | El frontend del carrito maneja el 422 con mensaje claro; documentar en swagger y reglas-negocio |
| 2   | `direccionId` pasa a formar parte del payload del POST                                                                | Documentar en swagger; el backend valida que la dirección pertenezca al usuario                 |
| 3   | ETA recién al confirmar (pedidos `pendientes` sin estimación)                                                         | UX: el front no muestra nada antes de confirmar                                                 |
| 4   | El radio de 5 km se reutiliza de cobertura de direcciones (`COBERTURA_RADIO_MAX_KM`)                                  | Documentar la reutilización en reglas-negocio                                                   |
| 5   | Reasignación recalcula el ETA de viaje (la cocina se mantiene)                                                        | En el service de ETA, separar cocina/viaje para reutilizar                                      |
| 6   | Dependencia de ORS en la confirmación agrega latencia (~1 s por ruta)                                                 | Degradar sin bloquear el pago; log del error                                                    |
| 7   | Migración sobre `Pedidos` (T2)                                                                                        | Columnas nullable: sin riesgo para filas existentes                                             |

## 7. Criterios generales de finalización

- Suite backend completa en verde (`--runInBand`, Node 14) con los tests de los casos límite de cada módulo; lint 0; builds OK.
- Verificación en vivo contra Georef/ORS de cada módulo con direcciones/sucursales reales.
- Docs actualizadas: este plan maestro + reglas-negocio (nueva sección por módulo) + swagger (nuevo 422, `etaMinutos`, `PATCH /sucursal`) + informe de iteración al cierre.
- Sin GPS, sin mapas interactivos, sin optimización avanzada, sin múltiples repartidores, sin cambios en pedidos/estados existentes fuera de lo descrito.
- Node 14.15.5 y lockfile intactos; cero dependencias nuevas.

## 8. Flujo de Git (acordado con el equipo)

- Rama de trabajo: **`feat/pedidos`** (base: dev con el PR #11 ya mergeado).
- **Un commit por tarea** (C1 refactor + C2 este plan + C3-C7 tareas T0-T4), cada uno verificado (suite + lint + builds) antes de commitear.
- **Push tras cada commit** (backup inmediato en GitHub).
- **Un único merge a `dev` al final del trabajo**: local, **sin PR**, **con aprobación explícita del equipo previa**. Luego push de dev.
