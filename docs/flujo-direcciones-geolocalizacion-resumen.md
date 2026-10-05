# Flujo resumido — Direcciones y Geolocalización de Comi-Rapi

Versión breve. El detalle completo (capas, servicios, taxonomía HTTP, mapas de archivos y fuentes) está en `flujo-direcciones-geolocalizacion.md`.

## El flujo en una vista

```
Cliente (Perfil → FormularioDireccion → useDireccionTerritorial)
  1. Cascada territorial: Provincia → Partido/Comuna → Localidad (combobox con
     búsqueda) → Calle (autocomplete contra el proxy) → Altura.
  2. "Verificar" → POST /api/geo/preview { ..., cobertura: true }  (sin persistir)
       Georef resuelve la identidad:
         • ambigua   → radios con opciones (partido/comuna + calle oficial) → re-verificar
         • única     → + cobertura real: zona (CABA + 40 partidos AMBA) y
                       sucursal activa a ≤5 km POR RUTA (ORS)
  3. Confirmación: ficha validada (territorio + calle/altura + CP si existe +
     referencia) + sucursal que atiende → "Guardar".
  4. POST /api/direcciones → el backend RE-VALIDA TODO (validación definitiva)
     y recién entonces persiste, con datos NORMALIZADOS por Georef.

Admin (EditarSucursal → FormularioSucursal): mismo formulario/hook, SIN
validación de cobertura — la sucursal puede registrarse fuera de la zona.
```

## Reglas clave

- **Zona habilita, sucursal decide**: CABA + 40 partidos del AMBA (INDEC) + una sucursal **activa** a ≤ **5 km por ruta** (ORS, nunca línea recta).
- El backend es la única fuente de verdad: el preview es informativo; el alta re-geocodifica y re-valida.
- Partido obligatorio cuando la provincia es Buenos Aires (desambigua direcciones repetidas entre partidos).
- Persistencia **normalizada por Georef**: provincia, calle, partido/comuna, localidad censal y nomenclatura. Código postal: null (Georef no lo provee).
- Editar cualquier dato de ubicación invalida la verificación previa; el guardado impide el doble submit.

## Endpoints

| Endpoint                                               | Qué hace                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /api/geo/departamentos?provincia=`                | Partidos/comunas (cache 24 h)                                             |
| `GET /api/geo/localidades?provincia=&departamento=`    | Localidades BAHRA (barrios en CABA)                                       |
| `GET /api/geo/calles?provincia=&departamento=&nombre=` | Autocomplete de calles (≥3 letras)                                        |
| `GET /api/geo/zonas`                                   | Zonas de operación (misma config que la validación)                       |
| `POST /api/geo/preview`                                | Resuelve identidad + (opt-in `cobertura: true`) cobertura. 200 con estado |
| `POST/PUT/DELETE /api/direcciones[/:id]`               | ABM del cliente; el POST/PUT valida TODO antes de persistir               |
| `POST/PUT /api/sucursales/:id` (dirección anidada)     | ABM admin; geocodifica sin validar cobertura                              |

## Resultados que el usuario puede ver

| Situación                               | Se presenta como                                       |
| --------------------------------------- | ------------------------------------------------------ |
| Datos inválidos / dirección inexistente | Corregí los datos                                      |
| Varias ubicaciones con el mismo nombre  | Elegí una opción de la lista                           |
| Provincia/partido fuera de la zona      | Aviso amarillo (ya al elegir) y bloqueo al guardar     |
| Zona OK pero sin sucursal a ≤5 km       | Bloqueo con la distancia de la sucursal más cercana    |
| Georef/ORS caídos                       | Error temporal con **Reintentar**                      |
| Dirección validada y atendible          | Ficha de confirmación + "Te atiende {sucursal} (X km)" |

## Piezas principales

- **Frontend**: `useDireccionTerritorial.js` (lógica única), `Autocomplete/OpcionesDireccionAmbigua/ConfirmacionDireccion/ResultadoDireccion` (presentación compartida), `FormularioDireccion`/`FormularioSucursal`, `api/geo.js` + `api/client.js` (CSRF).
- **Backend**: `routes/geo.js` + `geo_catalogo_service` (proxy con cache), `geolocation_service` (Georef + deduplicación por identidad territorial), `direccion_service` (orquestación del ABM), `cobertura_service` (zona + sucursales ≤5 km), `routing_service` (ORS), `cobertura-zonas.js` (40 partidos), `error_handler` (taxonomía 400/409/422/503).
- **Datos**: `Direcciones` con `departamento`/`nomenclatura` (migración `20261001000001`); seeds geocodificadas con el mismo servicio.

**Tests**: 439/439 (28 suites, Node 14) + verificación manual del flujo completo.
