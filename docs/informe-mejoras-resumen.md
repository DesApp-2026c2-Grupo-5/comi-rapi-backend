# Informe resumen — Mejoras de Direcciones y Geolocalización (Iteraciones 1–6)

Versión breve. Detalle por módulo: `informe-mejoras-detallado.md`. Flujo completo: `flujo-direcciones-geolocalizacion.md` / `-resumen.md`.

## Las seis mejoras en una tabla

| Módulo          | Mejora                                             | Qué aportó                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Iteración 1 | **Modelo territorial + desambiguación**            | `Direccion` alineada con Georef: `departamento` (partido/comuna) y `nomenclatura`; localidad y CP opcionales; **partido obligatorio en Buenos Aires**; ambigüedad con **409 + opciones** en vez de rechazo seco (deduplicación por identidad territorial: segmentos de una misma calle no son ambigüedad).                                                          |
| 2 — Iteración 2 | **Normalización total al persistir**               | Los cinco campos territoriales (provincia, calle, partido/comuna, localidad, nomenclatura) se persisten **normalizados por Georef**: la fila refleja exactamente la dirección resuelta.                                                                                                                                                                             |
| 3 — Iteración 3 | **Cascada, autocompletado y preview**              | Proxy `/api/geo/*` con cache (catálogos + `POST /preview` sin persistir); formularios con cascada provincia → partido → localidad → calle (autocomplete) → altura; flujo **Verificar → elegir coincidencia → confirmar → guardar**; fixes de los bugs de testeo manual (filtro BAHRA, estado oculto, congelamiento al borrar, autocomplete estable y distinguible). |
| 4 — Iteración 4 | **AMBA completo + UX**                             | Cobertura a los **40 partidos INDEC** (verificados contra Georef; regla conservada: la zona habilita, la **sucursal activa a ≤5 km por ruta** decide); formularios ordenados de general a específico con secciones, componentes compartidos y aviso por partido.                                                                                                    |
| 5 — Iteración 5 | **Validación de cobertura + manejo de resultados** | Preview con **cobertura real** (flag opt-in del cliente); `detalle.distanciaMasCercanaMetros` en los 422; taxonomía funcional vs técnico (Reintentar); anti doble-submit; fix del 503 engañoso (filtro `localidad` no existe en `/api/calles` — no era un límite de Georef).                                                                                        |
| 6 — Iteración 6 | **Presentación final**                             | Estado unificado de resultados con 4 variantes diferenciadas (`datos` / `cobertura-zona` / `cobertura-sucursal` con distancia / `tecnico` con Reintentar); **ficha de confirmación** antes de guardar (con CP solo si existe y la sucursal que atiende); `aria-live`.                                                                                               |

## Reglas invariantes del feature

- Solo sucursales **activas**; distancia **por ruta** (ORS); límite de **5 km**.
- **Zona habilita, sucursal decide**; el alta re-valida todo (el preview es informativo).
- Admin **sin** cobertura comercial; pedidos y asignación de sucursales intactos.
- Node 14.15.5 y dependencias actuales en todo momento; cero dependencias nuevas.

## Verificación global

**Backend 439/439 tests** (28 suites, `--runInBand`, Node 14) · lint 0 · build OK. **Frontend** `vite build` OK · eslint de lógica limpio · verificación manual E2E completa (cascada, desambiguación, bloqueo por cobertura, reintento técnico, doble submit, admin fuera de zona).
