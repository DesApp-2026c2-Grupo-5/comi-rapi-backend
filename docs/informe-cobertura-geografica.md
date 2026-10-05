# Informe — Reglas de cobertura geográfica (Tarea 5)

Documento que describe lo efectivamente implementado en la tarea de cobertura geográfica del backend. Fuente de verdad vigente: `docs/reglas-negocio.md` (§14, §15 y §16), `docs/modelo-dominio.md`, `docs/estructura-backend.md` y los informes de las tareas previas (`informe-georef.md`, `informe-ors.md`).

## 1. Objetivo

Definir e implementar la lógica de **cobertura geográfica**: determina si una dirección es válida para delivery, reutilizando los servicios de las tareas anteriores sin duplicar su lógica:

```
Direccion (calle, altura, provincia, localidad)
    → GeolocationService (Georef) → coordenadas
        → validación zona de operación (configurable)
        → RoutingService (ORS) → distancia real por ruta a sucursales activas
            → cobertura válida si hay al menos una sucursal activa dentro del radio máximo
```

Reglas en orden de evaluación (primero zona, luego sucursales):

1. La dirección debe **geocodificarse** (Georef): los errores tipados de Georef se propagan. Una dirección no geocodificable no es válida para delivery.
2. La dirección debe pertenecer a la **zona geográfica de operación**. Si no, no es válida y **no se consultan sucursales ni rutas** (se evitan llamadas innecesarias a ORS).
3. Debe existir al menos una **sucursal activa** con dirección geolocalizada dentro de la **distancia máxima**, medida como **distancia real por ruta** (no línea recta).

Fuera de alcance (tareas posteriores): ABM de `Direccion` (persistir coordenadas y validar al guardar), frontend, endpoints, ETA, costo de envío, asignación de sucursal por stock.

## 2. Decisiones tomadas

### 2.1 Servicio nuevo en `services/`, sin entidades nuevas

- Se creó `lib/services/cobertura_service.js` como servicio de **reglas de negocio** (arquitectura: `Services → Models → Database`), sin duplicar la lógica de `geolocation_service` ni `routing_service`.
- No se creó ninguna entidad ni ABM de zonas: la cobertura es regla de negocio, no entidad del DER.

### 2.2 Zona de operación: configuración genérica (no hardcodeada)

- La documentación del proyecto **no definía** la zona de operación (solo mencionaba "validación CABA/AMBA, radio de 5 km" como tarea pendiente), por lo que se verificó la definición y se **documentó explícitamente** (ver §2.3).
- La zona se valida contra una **configuración genérica** de zonas (`lib/config/cobertura-zonas.js`): estructura de datos, no lógica. Cada zona define `provincias` (obligatorio) y listas opcionales de `departamentos`/`localidades`; lista vacía = no se filtra por ese nivel.
- La comparación es insensible a mayúsculas/minúsculas y acentos, contra los **datos territoriales normalizados de Georef** (no contra el texto crudo ingresado).
- Agregar o quitar zonas/partidos **no requiere modificar el servicio**: solo editar la configuración.

### 2.3 Definición adoptada de AMBA

La definición oficial del AMBA / Región Metropolitana de Buenos Aires (INDEC) es: **CABA + la totalidad de los 40 partidos bonaerenses** que la rodean. Para esta etapa la configuración incluye:

- **CABA**: provincia completa (`Ciudad Autónoma de Buenos Aires`; Georef mapea sus comunas a `departamento`, por lo que no se filtra por departamento).
- **AMBA**: provincia `Buenos Aires` + los partidos del **primer y segundo cordón del conurbano**: Almirante Brown, Avellaneda, Berazategui, Esteban Echeverría, Ezeiza, Florencio Varela, General San Martín, Hurlingham, Ituzaingó, José C. Paz, La Matanza, Lanús, Lomas de Zamora, Malvinas Argentinas, Merlo, Moreno, Morón, Quilmes, San Fernando, San Isidro, San Miguel, Tigre, Tres de Febrero y Vicente López.
- Los partidos restantes del AMBA (Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Exaltación de la Cruz, General Las Heras, General Rodríguez, La Plata, Luján, Marcos Paz, Pilar, Presidente Perón, San Vicente, Zárate) pueden agregarse a la lista sin tocar el servicio.

Nota: dado que la cobertura exige además una sucursal activa a ≤ 5 km por ruta, los partidos más alejados solo resultarían alcanzables si hubiera sucursales cerca; por eso la lista inicial se centró en el conurbano cercano. La decisión es configurable y revisable.

### 2.4 Distancia máxima configurable

- 5 km inicial, vía `COBERTURA_RADIO_MAX_KM` (bloque `cobertura` en `lib/config/config.js`). Sin hardcodear.
- Patrón consistente con los bloques `georef` y `ors` existentes.

### 2.5 Resultado detallado (no errores por regla incumplida)

- `validarCoberturaDireccion` devuelve un objeto detallado con `coberturaDisponible` en lugar de lanzar un error cuando la regla no se cumple: quien lo consuma (validación del pedido, endpoints de tareas posteriores) decide cómo tratarlo.
- Los errores de infraestructura (Georef/ORS) sí se propagan.

## 3. Archivos creados/modificados

| Archivo                                  | Acción     | Contenido                                                                                   |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `lib/services/cobertura_service.js`      | Creado     | Reglas de cobertura: `evaluarZona`, `obtenerSucursalesActivas`, `validarCoberturaDireccion` |
| `lib/config/cobertura-zonas.js`          | Creado     | Zonas de operación configurables (CABA + partidos AMBA incluidos, documentados)             |
| `lib/config/config.js`                   | Modificado | Bloque `cobertura: { radioMaxKm }`                                                          |
| `.env.development`                       | Modificado | `COBERTURA_RADIO_MAX_KM=5`                                                                  |
| `.env.example`                           | Modificado | Ídem (con comentario)                                                                       |
| `.env.test`                              | Modificado | Ídem                                                                                        |
| `lib/services/cobertura_service.test.js` | Creado     | 18 tests con APIs mockeadas                                                                 |
| `docs/reglas-negocio.md`                 | Modificado | Nueva §16 "Cobertura geográfica"; alcance actualizado en §14/§15                            |
| `docs/modelo-dominio.md`                 | Modificado | Regla de negocio (§7.2) actualizada                                                         |
| `docs/estructura-backend.md`             | Modificado | Servicio documentado y estado de implementación                                             |

No se modificaron: controllers, routes, modelos, migraciones, seeders, Swagger, frontend. **Sin commits ni push** (a revisión del equipo).

## 4. Arquitectura utilizada

- Capa `services` con las convenciones del proyecto (header de documentación, config en `lib/config/`, tests junto al código).
- Reutilización estricta: `geolocation_service` (geocodificación) y `routing_service` (distancia por ruta). Sin lógica HTTP duplicada.
- Acceso a la BD vía modelos Sequelize (`db.Sucursal.findAll` con `Direccion` incluida, 1:1). La lista de sucursales puede inyectarse (`sucursales`), lo que permite testear sin BD y facilita la reutilización futura.
- Sin cache, colas ni reintentos (alcance académico). Sin dependencias nuevas.

## 5. Funcionamiento de `validarCoberturaDireccion`

- **Entrada**: `{ direccion: { calle, altura, provincia, localidad }, sucursales = null }`. `codigoPostal` no se usa en la query de Georef (no admitido por el endpoint).
- **Flujo**:
  1. Geocodifica con `geolocation_service.geocodificarDireccion` → coordenadas + datos normalizados. Errores tipados de Georef se propagan.
  2. Valida zona con `evaluarZona(normalizada, ZONAS_COBERTURA)` (función pura). Fuera de zona → `dentroZona: false`, `coberturaDisponible: false`, sin llamadas a ORS.
  3. Obtiene sucursales **activas** con dirección geolocalizada (o usa la lista inyectada; las inactivas y sin coordenadas se ignoran siempre).
  4. Calcula la **distancia real por ruta** a cada sucursal con `routing_service.calcularRuta({ origen: sucursal, destino: dirección })` y ordena por `distanciaMetros`.
  5. Cobertura válida ⇔ hay al menos una sucursal con `distanciaMetros <= radioMaxKm * 1000`. Devuelve la más cercana.
- **Salida**: `{ dentroZona, zona, sucursal: { id, nombre, distanciaMetros } | null, coberturaDisponible, radioMaxKm, mensaje, coordenadas }`.

## 6. Configuración agregada

| Variable                 | Default | Descripción                                   |
| ------------------------ | ------- | --------------------------------------------- |
| `COBERTURA_RADIO_MAX_KM` | `5`     | Distancia máxima de delivery en km (por ruta) |

Zonas: `lib/config/cobertura-zonas.js` (versionada, editable). Ver §2.2 y §2.3.

## 7. Tests

- `lib/services/cobertura_service.test.js`: **18 tests**, con `jest.mock('node-fetch')` y `../models` mockeado: **no dependen de APIs externas ni de BD** en la suite automática.
- Cobertura de los tests:
  - Zona: CABA → `zona: 'CABA'`; partido AMBA (San Isidro) → `zona: 'AMBA'`; provincia fuera (Córdoba) → `dentroZona: false` **sin llamar a ORS**; partido habilitado por provincia pero fuera de la lista (La Plata) → `dentroZona: false`.
  - Cobertura: sucursal activa dentro del radio → `coberturaDisponible: true` con distancia por ruta; devuelve la **más cercana**; todas fuera del radio → `false` (conservando la más cercana como referencia); solo considera sucursales **activas** (la inactiva se ignora); sucursal sin coordenadas se ignora; sin sucursales activas → `false`.
  - Configuración: `radioMaxKm` configurable (`config.cobertura.radioMaxKm`).
  - Entrada y errores: dirección sin datos obligatorios → error sin llamar a APIs; `DireccionNoEncontradaError` se propaga; `OrsError` (HTTP 500) se propaga; consulta a BD (`obtenerSucursalesActivas`) con `where activa: true` e ignorando filas sin coordenadas.
  - `evaluarZona`: coincidencia insensible a mayúsculas/acentos, normalizada incompleta → `null`, provincia no habilitada → `null`, lista vacía → `null`.
- **Suite completa**: `npm test` → **167/167 pasan (14 suites)**, incluidos los tests de Georef y ORS de las tareas previas.
- Verificación en vivo: pendiente (requiere ORS key real en `.env.local` y direcciones reales; se sugiere al integrar con el ABM/frontend).

## 8. Hallazgos durante la ejecución

- Al reutilizar el servicio con la lista de sucursales inyectada, era necesario filtrar también las **inactivas** (la consulta a BD ya lo hacía, pero la inyección no): la regla "solo sucursales activas" ahora se aplica siempre, con test que lo cubre.
- La BD de test necesitaba las migraciones de promociones traídas del merge de `dev` (`2026092800000{1,2,3}-*`): se aplicaron con `NODE_ENV=test sequelize db:migrate` para que la suite completa pase. La BD de desarrollo aplicará esas migraciones en el próximo `npm run dev` / `db:migrate`.

## 9. Puntos pendientes (tareas posteriores)

- Integración con el ABM de `Direccion`: geocodificar y persistir `latitud/longitud` al guardar, y validar cobertura al ingresar la dirección.
- Consumo de `validarCoberturaDireccion` en la validación del pedido (endpoints/frontend).
- Verificación en vivo contra Georef/ORS con direcciones reales.
- Revisar si la lista de partidos del AMBA inicial debe ampliarse (configurable, sin tocar el servicio).
