# Informe — Tarea 7: Postman, pruebas y cierre de geolocalización

Documento de cierre de la funcionalidad de direcciones y geolocalización. Fuentes: `docs/flujo-direcciones-geolocalizacion.md`, `docs/informe-mejoras-detallado.md`, `docs/swagger.yml`, `docs/reglas-negocio.md` (§14–§19).

## 1. Auditoría del estado (hallazgos)

- **Pruebas automatizadas**: el feature estaba cubierto por geolocation, geo_catalogo, rutas `/api/geo`, cobertura, direccion_service, routing y los controllers de direcciones/sucursales. Se detectaron **3 gaps menores** (§2) que se cerraron en esta tarea.
- **Postman**: no existía ninguna colección en ninguno de los dos repos → se creó desde cero tomando `docs/swagger.yml` como fuente de contratos.
- **Credenciales** ✅ (auditoría formal): `.env.local` NO trackeado y contiene la única copia de la `ORS_API_KEY` (gitignored por `.env.*`); los `.env.{development,test,example}` versionados la dejan **vacía**; `SESSION_SECRET` de dev marcada como no-productiva. `git grep ORS_API_KEY=` solo encuentra valores vacíos en archivos trackeados. **Sin secrets en el repo.**
- **Hallazgo de entorno durante la tarea**: la BD de test apareció vacía (volumen de Postgres reseteado — coherente con el procedimiento de `docs/reset-db.md`) y la BD de desarrollo también. Se volvieron a aplicar migraciones y seeders en ambas (los seeders geocodifican contra Georef real). Queda registrado como recordatorio para el equipo: cada reset del volumen exige re-migrar test+dev.
- **Hallazgo en vivo**: la primera pasada de verificación crasheó porque "Av. Colón 100, Córdoba" resuelve **ambigua** en Georef (Capital + General San Martín) — corregido agregando `departamento: 'Capital'` en los casos de fuera de zona (script y colección). Ídem "Calle 7 900, La Plata" (19 resultados) → reemplazada por **"Diagonal 74 1200"** (única, verificada). El registro devuelve **201**, no 200 → expectativas corregidas; el caso del "otro usuario" quedó tolerante a re-ejecuciones (registro 201/400/409 + login explícito). Ninguno es defecto del backend: son correcciones de los casos de prueba contra datos reales de Georef.

## 2. Tests de cierre agregados (T1)

1. `POST /api/geo/preview` con `cobertura: true` y **ninguna sucursal activa** → `coberturaDisponible: false`, `sucursal: null` y **0 llamadas a ORS** (`lib/routes/geo.test.js`).
2. **Regla partido-PBA en update parcial** que cambia la provincia a Buenos Aires sin partido → 400 **antes** de llamar a Georef (`lib/services/direccion_service.test.js`).
3. **Contrato de `/api/geo/zonas`**: la zona AMBA contiene los **40 partidos** INDEC (incluye La Plata, Zárate, Presidente Perón) (`lib/services/geo_catalogo_service.test.js`).

## 3. Colección Postman (T2)

`docs/postman/comi-rapi-geo.postman_collection.json` + `geo-local.postman_environment.json` (importables). 5 carpetas en orden: **Setup** (health + CSRF con guardado automático del token), **Geo catálogo** (departamentos/localidades/calles/zonas con sus 400), **Preview** (única/ambigua/no encontrada/cobertura OK/fuera de zona/400), **Direcciones cliente** (201 normalizada, 409, 422×2 con `detalle`, 400×2, GET/PUT/DELETE, 403 con usuario auxiliar tolerante a re-ejecución) y **Sucursales admin** (201 en zona, **201 fuera de zona — regla conservada**, PUT). Cada request lleva sus `pm.test` con el resultado esperado.

## 4. Verificación funcional en vivo (T3) — 34/34

Ejecutada contra el backend real (Georef y ORS vivos, seeds cargados, `ORS_API_KEY` de `.env.local`), replicando exactamente el flujo de la colección: **34/34 casos OK**, incluidos:

- Preview con cobertura → **Sucursal Palermo a 588 m por ruta** (ORS real).
- Alta de dirección → 201 con `departamento`/`nomenclatura` normalizados y coords persistidas; `codigoPostal` null.
- Sin cobertura en La Plata (Diagonal 74 1200) → 422 con `detalle.distanciaMasCercanaMetros` = **57.206 m**.
- Admin registra sucursal en **Bahía Blanca** (fuera de la zona de operación) → 201 (regla conservada).
- 409/422/400 según taxonomía; 403 por dirección ajena; baja lógica OK.
  Los datos de prueba generados se **limpiaron** (dev DB vuelve al estado de seeds). El script de verificación quedó con watchdog + timeouts para no repetir el cuelgue del primer intento (causa: dirección ambigua inesperada + proceso del server en background reteniendo la sesión — corregido con try/finally que siempre lo detiene).

## 5. Checklist manual del frontend (para el equipo)

Con `npm run dev` en ambos repos y la BD migrada+seedeada:

1. Perfil → Agregar dirección → cascada Provincia → Partido → Localidad → Calle (autocomplete distinguible por comuna/partido) → Altura.
2. Verificar → (si hay opciones, elegir) → ficha de confirmación con sucursal que atiende y km → Guardar → la dirección aparece con datos normalizados.
3. Editar un dato de ubicación tras validar → la ficha desaparece (re-verificación obligatoria).
4. Dirección fuera de zona (ej. Córdoba) → aviso amarillo al elegir provincia + bloqueo al verificar.
5. Dirección en zona sin sucursal a 5 km (ej. Diagonal 74 1200, La Plata) → bloqueo con distancia de la sucursal más cercana.
6. Eliminar una dirección → confirmación inline, sin congelamientos.
7. Admin: alta de sucursal dentro y fuera de la zona → ambas deben guardar (geocodificadas).

## 6. Documentación actualizada (T5)

- `README.md`: nueva sección "Pruebas y colección Postman (geolocalización)" (niveles de prueba, prerequisitos, credenciales).
- Este informe. Sin duplicar: swagger/flujo/mejoras quedaron vigentes en la consolidación de la iteración anterior.

## 7. Verificación final (T6)

- Backend: suite completa `--runInBand` (Node 14) con los 3 tests nuevos; lint; build.
- Frontend: `vite build` + eslint de lógica.
- Postman: JSON de colección y environment validados (parse OK).

## 8. Defectos y riesgos al cierre

- **Sin defectos abiertos en el feature**: suite verde, 34/34 en vivo, colección corregida contra datos reales de Georef.
- Pendientes documentados que NO bloquean el cierre (decisiones de etapas posteriores): backfill opcional de direcciones legadas; alineación del snapshot de `Pedido` (`ciudad`→`localidad`, etapa pedidos); lint del frontend preexistente en archivos de otros equipos.
- Riesgo operativo: cada reset del volumen de Postgres exige re-migrar test+dev y re-seedear (documentado arriba y en `docs/reset-db.md`).

## 9. Propuesta de cierre Git (pendiente de aprobación — no ejecutada)

1. Commits del trabajo acumulado en ambas feat (iteraciones 5–6 + fix 503 + consolidación de docs + tarea 7).
2. Verificación completa post-commit (suite + builds).
3. `git fetch origin` + `pull` de `dev` en ambos; merge `dev → feat` (ante conflicto no seguro: detener y reportar).
4. Re-verificación post-merge.
5. **Push solo con aprobación explícita del equipo**; ningún merge `feat → dev` sin aprobación; jamás `reset`/`clean`.
