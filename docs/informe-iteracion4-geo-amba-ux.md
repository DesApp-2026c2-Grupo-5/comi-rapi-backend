# Informe — Iteración 4: ampliación de cobertura AMBA completa y UX de formularios de dirección

Documento que describe lo planificado/implementado en la iteración 4. Fuentes: `docs/reglas-negocio.md` (§16, §19), informe de la iteración 3. **Sin commit al cierre de esta iteración: queda para revisión manual.**

## 1. Mejora A — Cobertura: AMBA completo (solo configuración)

- **Cambio**: `lib/config/cobertura-zonas.js` pasa de 24 partidos (1er/2do cordón) a los **40 partidos completos** de la definición INDEC del AMBA ya adoptada por el proyecto. Los 16 agregados (Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Exaltación de la Cruz, General Las Heras, General Rodríguez, La Plata, Luján, Marcos Paz, Pilar, Presidente Perón, San Vicente, Zárate) fueron **verificados contra los departamentos de Georef** de la provincia de Buenos Aires (la comparación de zonas es insensible a mayúsculas/acentos, igual que la verificación).
- **Delimitación**: se mantiene la lista explícita de 40 partidos; NO se habilita toda la provincia (partidos como Bahía Blanca o General Pueyrredón siguen fuera de la zona).
- **Arquitectura intacta**: el cambio es solo el array de configuración; `cobertura_service`, ORS y los 5 km no se tocan. La separación "zona habilita / sucursal activa ≤5 km por ruta decide" ya estaba correctamente representada (`evaluarZona` → `evaluarSucursales`, errores tipados distintos) y se conserva.
- **Efecto visible**: direcciones del 3er cordón (antes `DireccionFueraDeZonaError`) pasan a evaluarse por sucursales; si no hay ninguna cerca, el rechazo es `DireccionSinCoberturaError` (mensaje distinto, mismo resultado operativo). Documentado en §16.
- **Tests**: el caso "La Plata → fuera de zona" pasa a **dentro de zona + sin cobertura** (regla conservada explícita); nuevo caso positivo para un partido agregado (Pilar); el caso negativo usa **Bahía Blanca** (partido de la provincia fuera del AMBA).
- **Frontend**: sin cambios obligatorios para la cobertura (el aviso de provincia sigue siendo correcto: "Buenos Aires" está habilitada). Decisión aprobada: se agrega un **aviso informativo a nivel partido** (cuando la provincia es Buenos Aires y el partido elegido no integra la zona) usando los `departamentos` que ya expone `GET /api/geo/zonas` — informativo; el backend sigue decidiendo al guardar.

## 2. Mejora B — UX de formularios

- **Orden general→específico** (ambos formularios): Provincia → Partido/Comuna → Localidad → Calle → Altura → datos complementarios (alias/referencia en cliente; horarios/teléfono/estado en admin, con el nombre de la sucursal primero). El gate "calle espera a la provincia" se conserva y ahora fluye con el orden visual.
- **Reutilización**: se extraen los dos bloques duplicados como componentes presentacionales compartidos: `OpcionesDireccionAmbigua.jsx` (radios + re-verificar) y `ConfirmacionDireccion.jsx` (alert de confirmación con nomenclatura/coordenadas + guardar/editar). La lógica territorial sigue en `useDireccionTerritorial` (única fuente) y el input de búsqueda en `Autocomplete`.
- **Visual (convenciones de dev adoptadas en el merge)**: `direccion-form-card` / `formulario-admin-card` (ancho por CSS, sin inline styles), `h3.h5` semántico, `noValidate`, `role="alert"`. CSS scoped nuevo (`DireccionFormulario.css`) con jerarquía de secciones ("Ubicación" / "Dirección" / complementarios) y estados diferenciados usando la identidad existente (naranja `#ff9f1c`, danger para error, success para confirmación) — sin dependencias nuevas ni rediseño global.

## 3. Git de esta iteración

- Cierre de la iteración 3 aprobado antes de comenzar: commits `1e98acc` (backend) y `da02ce6` (frontend) + sync de dev. El frontend requirió merge real (dev trajo el rediseño UI de 79 archivos): merge `46893d3`, conflictos resueltos conservando el rework territorial y adoptando las convenciones visuales de dev. El fix del bug C en `Perfil.jsx` sobrevivió al auto-merge (verificado).

## 4. Verificación

- Backend: suite completa `--runInBand` (Node 14) con los tests de zona actualizados, lint, build.
- Frontend: `vite build` post-merge y post-cambios, eslint de los archivos propios.
- Manual: flujo completo en Perfil (orden nuevo, autocomplete estable, preview), admin en EditarSucursal, dirección en La Plata (dentro de zona → "sin cobertura" si no hay sucursal), partido fuera del AMBA (aviso amarillo inmediato + rechazo "fuera de zona" al guardar).

## 5. Fuera de alcance (explícito)

- Tarea 7 (Postman/pruebas/cierre), pedidos, asignación de sucursales, radios configurables, polígonos, ORS y el límite de 5 km.
