# Informe de feature — Reasignación exclusiva del superadmin, contexto de sucursal operativo y sugerencias territoriales

> Iteración de la rama `feat/reasignacion-superadmin-cobertura` (backend y frontend). Cierra el plan de las tres funcionalidades: F1 reasignación manual segura, F2 superadmin operando una sucursal, F3 sugerencias de direcciones por sucursales activas.

---

## 1. Qué se hizo y por qué

### La reasignación manual pasó a ser exclusiva del superadmin

Antes, el endpoint `PATCH /api/pedidos/:id/sucursal` solo exigía rol ADMIN: cualquier administrador de cualquier sucursal podía reasignar el pedido de cualquier otro local manipulando el request (el hueco de autorización reportado). En lugar de acotar al admin a su sucursal, la regla de negocio se simplificó: **los administradores de sucursal ya no reasignan manualmente**; la excepción operativa queda centralizada en el superadmin, que solo opera dentro de una sucursal elegida y hacia destinos que el propio backend valida: activos, **dentro de la cobertura de la dirección del cliente** (radio vigente por ruta, ranking cache-first) y **con stock suficiente** (transferencia atómica de la reserva + trazabilidad en el historial + recálculo de ETA).

Un endpoint nuevo, `GET /api/pedidos/:id/sucursales-candidatas`, alimenta el selector del panel con exactamente esos destinos ("cobertura + stock", con su distancia). El botón desapareció del panel del admin y el modal del superadmin ofrece solo candidatas: si no hay ninguna, lo dice en lugar de dejar elegir un destino que el backend rechazaría.

Además, el recálculo de ETA de la reasignación se movió **fuera de la transacción** (igual que en el pago): antes la transacción —con locks sobre el stock de las dos sucursales— quedaba esperando una red externa; ahora el cálculo va post-commit y degrada a "sin ETA" si el proveedor falla.

### El superadmin puede operar una sucursal sin dejar de ser superadmin

El mecanismo es un **contexto de sucursal en la sesión**: `POST /api/auth/sucursal-contexto` valida que la sucursal exista y esté activa y la guarda en la sesión; `DELETE` la limpia. `/api/auth/me` expone `sucursalOperativa` (para el admin es su sucursal asignada; uniforme para el frontend). El scoping operativo sale siempre de la sesión (`sucursalOperativaDeSesion`), nunca de un id del request.

Con contexto, el superadmin avanza/cancela estados y opera el stock de esa sucursal con las mismas reglas que su administrador (rol efectivo ADMIN en la matriz de transiciones, `acotarASucursalPropia` por contexto). Sin contexto, toda operación responde 403 con "Elegí una sucursal para operar". Su **lectura de pedidos sigue siendo global** y sus capacidades corporativas (resumen, reportes, CRUD de sucursales/usuarios/catálogo, parámetros) no cambian: el panel operativo filtra por contexto en el frontend; la API no recorta su visión.

En el canal realtime, el handshake une al superadmin con contexto también a la room de esa sucursal: ve stock y pedidos de su contexto en vivo. Al cambiar el contexto, el frontend reconecta el socket (las rooms se resuelven al conectar).

De paso se corrigió un bug preexistente: el superadmin (dueño del CRUD y de las bajas lógicas) no podía listar ni ver sus sucursales inactivas (`?activa=false` y `show` eran exclusivos del rol ADMIN).

### Las sugerencias de direcciones ya no ofrecen zonas sin sucursales

La lista de provincias era estática (24 nombres, incluida Catamarca). Ahora el backend expone `GET /api/geo/territorio-operativo`: provincias y partidos/comunas **derivados de las direcciones de las sucursales activas geolocalizadas** (reusa `obtenerSucursalesActivas`, la misma regla que la cobertura), con cache en memoria de 5 minutos. El formulario del cliente limita sus selects y su validación a ese territorio (hoy: Buenos Aires + CABA; nada de Catamarca); el formulario de sucursales del superadmin conserva la lista completa para poder abrir zonas nuevas.

Distinción preservada: esto es solo el criterio "hay sucursal activa en la zona". La cobertura real (radio por ruta) la sigue decidiendo el preview con `cobertura=true` y la validación definitiva del alta — una dirección sugerida puede igualmente quedar fuera de cobertura y el backend la rechaza igual.

## 2. Verificación ejecutada

| Chequeo                                         | Resultado                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suite backend completa (`--runInBand`, Node 14) | 45/45 suites · 708/708 tests (656 de baseline + 52 nuevos/actualizados)                                                                                                                            |
| Lint backend                                    | 0 errores 0 warnings                                                                                                                                                                               |
| Build backend (Babel) / frontend (Vite)         | ✓ 143 archivos / ✓                                                                                                                                                                                 |
| Tests nuevos                                    | Matriz 403 de reasignación, contexto (set/limpiar/aislamiento), estados y stock con contexto, room realtime del contexto (caso 8), inactivas del superadmin, territorio operativo (cache incluida) |

## 3. Limitaciones conocidas

1. **Barra inferior móvil**: el selector de contexto vive en el Navbar superior; la barra inferior del superadmin no suma accesos operativos (el panel es utilizable vía el menú superior también en móvil).
2. **Suite realtime end-to-end** (`test/tiempo-real/protocolo.js`): preexistente, depende del backend levantado y de ORS real; se verifica al cierre.
3. **Contexto vencido**: si una sucursal se desactiva con el contexto ya elegido, la sesión lo conserva (paridad con el admin de una sucursal desactivada, situación preexistente); el selector solo ofrece activas y al cambiar el contexto se valida la activa.
4. **Lint del frontend**: viene rojo en `dev` (errores `no-unused-vars` de `React` en ~40 archivos preexistentes, p. ej. `Loader.jsx`); los archivos nuevos siguen la convención del código existente y los archivos tocados no suman errores nuevos.
