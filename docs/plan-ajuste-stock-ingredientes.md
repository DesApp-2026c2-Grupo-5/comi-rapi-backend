# Plan — Ajuste rápido de stock de ingredientes

**Proyecto:** Comi-Rapi / DesApp 2026c2 — Grupo 5  
**Fecha:** 2026-11-20  
**Estado:** propuesto, pendiente de aprobación  
**Alcance:** frontend + ajuste chico de backend  
**Pantalla:** Admin → Stock por sucursal → filtro **Ingredientes**

---

## 1. Objetivo

Agregar un botón **«Ajustar stock»** al lado de **«Quitar»** en la columna
**Acciones** de las filas de ingredientes. El botón abre el modal simple que ya
usa la app y permite sumar o restar una cantidad al stock actual del ingrediente
de esa sucursal.

Regla central: si se resta más de lo que hay, el stock queda en **0**. Nunca
negativo.

---

## 2. Mockups

Generados como SVG autocontenidos y renderizados a PNG:

- `mockups/stock-ingredientes-1-tabla.svg` / `.png` — botón en la tabla.
- `mockups/stock-ingredientes-2-modal.svg` / `.png` — modal abierto.

Diseño propuesto:

- Botón `outline-primary`, tamaño `sm`, ícono de ajustes/sliders, texto
  **«Ajustar stock»**, ubicado antes del botón rojo **«Quitar»**.
- Modal centrado (`ModalBase`), con:
  - nombre del ingrediente y unidad;
  - stock actual;
  - input numérico de cantidad (hasta 3 decimales);
  - vista previa del resultado estimado;
  - botones **Cancelar**, **− Restar** y **+ Sumar**.

> El generador de imágenes del proveedor falló por saldo insuficiente. Los
> mockups se armaron como SVG y se rasterizaron localmente con Edge headless.

---

## 3. Relevamiento

### 3.1 Pantalla

`comi-rapi-fronted/src/pages/admin/GestionStock.jsx`

- La tabla es única para productos, combos, insumos e ingredientes.
- El filtro **Ingredientes (15)** ya existe.
- Las filas de ingredientes se distinguen con `fila.clase === 'ingrediente'`.
- La columna **Acciones** hoy sólo renderiza **«Quitar»**.
- La edición en línea de cantidad ya llama a `actualizarStockIngrediente`.

### 3.2 Modal reutilizable

- `components/comunes/ModalBase.jsx`: shell simple (título, cierre, foco, body
  con scroll y footer).
- `components/comunes/ModalFormulario.jsx`: variante con slot de error.
- Ya se usa en `GestionIngredientes`, `FormularioInsumo`, `ConfirmarModal`, etc.
- Para este caso conviene `ModalBase` directo porque hay **dos acciones**
  (Sumar / Restar), no un único submit.

### 3.3 API y backend

- `PUT /api/stock/ingredientes/:ingredienteId`
  - hoy acepta `{ cantidad, disponible }`;
  - `cantidad` es absoluta y el service rechaza negativos;
  - `IngredienteStock.cantidad` es `DECIMAL(12,3)` con `CHECK (cantidad >= 0)`.
- `GET /api/stock/ingredientes` devuelve la fila completa serializada.
- El controller, después de actualizar, sincroniza productos/combos derivados y
  emite `stock_actualizado`.
- `RealtimeBridge` invalida la consulta de ingredientes y parchea productos e
  insumos.

### 3.4 Problemas detectados en el código actual

1. **«Quitar» en ingredientes está roto.** El `onClick` manda la fila a
   `setStockAEliminar`, y `confirmarEliminar` llama a
   `eliminarStock(sucursalId, productoId)` con `productoId` indefinido. Además el
   mensaje usa `fila.producto`, que tampoco existe en ingredientes. No hay
   endpoint `DELETE` de stock de ingredientes.
2. **La caché de ingredientes se actualiza como producto.** En `guardarFila`:
   `reemplazarFilaEnCache(esInsumo ? 'insumo' : 'producto', data)` no contempla
   `esIngrediente`. La fila editada no se refleja en la caché de ingredientes.
3. **La edición en línea rechaza decimales.** El `onBlur` exige
   `Number.isInteger(valor)`, aunque el input de ingredientes usa `step="0.001"`.
   Los decimales no se guardan.
4. `versionSocket` se desestructura en `GestionStock` pero no se usa (menor).

---

## 4. Propuesta funcional

### 4.1 Botón

- Sólo en filas `clase === 'ingrediente'`.
- `variant="outline-primary"`, `size="sm"`, `className="me-2"`.
- Ícono: `FaSlidersH` (o `FaExchangeAlt`).
- Texto visible: **Ajustar stock**.
- `aria-label` con el nombre del ingrediente.
- El botón **«Quitar»** se mantiene a la derecha.

### 4.2 Modal

Título: **Ajustar stock**.

Cuerpo:

- Tarjeta con:
  - `Harina 000 (kg)`;
  - `Stock actual: 12.500 kg`.
- Label: **Cantidad a sumar o restar**.
- Input `type="number"`:
  - `min="0.001"`, `step="0.001"`, `inputMode="decimal"`;
  - valor inicial `1` (o vacío, a definir);
  - foco automático.
- Ayuda: «Sumá o restá esta cantidad al stock actual. Si restás más de lo
  disponible, el stock queda en 0.»
- Vista previa en vivo:
  - `Resultado estimado: 13.500 kg si sumás · 11.500 kg si restás`.

Footer:

- **Cancelar** (`secondary`).
- **− Restar** (`outline-danger`).
- **+ Sumar** (`primary`).

Comportamiento:

- Cada botón aplica el ajuste y cierra el modal si sale bien.
- Mientras guarda, los tres botones quedan deshabilitados y el modal no se
  cierra.
- Si falla, el error se muestra dentro del modal (`Alert`), sin cerrarlo.
- Validación: cantidad finita, mayor a 0 y con hasta 3 decimales.
- Al restar más que el stock actual, la vista previa ya muestra 0.

> Alternativa posible: stepper `−` / `+` que modifica el input y un único botón
> **Aplicar**. El mockup usa la variante de dos acciones directas porque refleja
> mejor «sumar o restar».

---

## 5. Cambios técnicos

### 5.1 Backend — ajuste relativo atómico

**Archivo:** `comi-rapi-backend/lib/services/ingredientes_catalogo.js`

Extender `actualizarStockDeIngrediente` para aceptar `ajuste` (delta con signo)
además de `cantidad` (absoluta):

- Rechazar si vienen `cantidad` y `ajuste` juntos.
- Validar `ajuste`: finito, distinto de 0, hasta 3 decimales.
- Garantizar la fila con `findOrCreate`.
- Si viene `ajuste`, aplicar un `UPDATE` atómico que clampea en la base:

```sql
UPDATE "IngredienteStocks"
SET "cantidad" = GREATEST(0, "cantidad" + :ajuste),
    "updatedAt" = NOW()
WHERE "sucursalId" = :sucursalId
  AND "ingredienteId" = :ingredienteId
```

Esto cumple la regla «nunca negativo» sin depender de la UI ni de una lectura
previa, y evita carreras entre dos administradores.

- Mantener `cantidad` absoluta para la edición en línea existente.
- Devolver la fila serializada como hoy.

**Archivo:** `comi-rapi-backend/lib/controllers/stock_controller.js`

- Sin cambios funcionales: ya llama al service, sincroniza productos/combos y
  emite `stock_actualizado`.

### 5.2 Frontend — API

**Archivo:** `comi-rapi-fronted/src/api/stock.js`

- Actualizar el JSDoc de `actualizarStockIngrediente` para documentar
  `{ cantidad?, disponible?, ajuste? }`.
- Sin cambio de firma.

### 5.3 Frontend — modal

**Archivo nuevo:** `comi-rapi-fronted/src/components/admin/AjustarStockIngredienteModal.jsx`

Props:

```jsx
<AjustarStockIngredienteModal
  mostrar={Boolean(ingredienteAAjustar)}
  fila={ingredienteAAjustar}
  cargando={guardandoAjuste}
  error={errorAjuste}
  onCerrar={cerrarAjuste}
  onAplicar={aplicarAjuste} // ({ operacion: 'sumar' | 'restar', cantidad })
/>
```

- Usa `ModalBase`.
- Estado local de `cantidad` y validación.
- Reset del input al abrir/cambiar de fila.
- Vista previa calculada en el cliente sólo para mostrar; la autoridad es el
  backend.
- Formatea con `Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })`.

### 5.4 Frontend — página

**Archivo:** `comi-rapi-fronted/src/pages/admin/GestionStock.jsx`

1. Importar el modal y `FaSlidersH`.
2. Estados:
   - `ingredienteAAjustar`;
   - `guardandoAjuste`;
   - `errorAjuste`.
3. `abrirAjuste(fila)` y `cerrarAjuste()`.
4. `aplicarAjuste({ operacion, cantidad })`:
   - `ajuste = (operacion === 'restar' ? -1 : 1) * cantidad`;
   - `actualizarStockIngrediente(fila.ingredienteId, { ajuste })`;
   - si ok: notificar, `reemplazarFilaEnCache('ingrediente', data)`, cerrar;
   - si falla: setear `errorAjuste`.
5. Renderizar el botón sólo si `esIngrediente`.
6. Renderizar el modal junto a los `ConfirmarModal` existentes.

### 5.5 Correcciones incluidas

- **Caché de ingredientes:** cambiar
  `reemplazarFilaEnCache(esInsumo ? 'insumo' : 'producto', data)` por
  `esInsumo ? 'insumo' : esIngrediente ? 'ingrediente' : 'producto'`.
- **Decimales en línea:** reemplazar `Number.isInteger(valor)` por una
  validación que acepte hasta 3 decimales en ingredientes y mantenga enteros en
  insumos.
- **«Quitar» en ingredientes:** implementar su propio flujo, análogo al de
  insumos:
  - confirmación con el nombre del ingrediente;
  - `actualizarStockIngrediente(id, { cantidad: 0, disponible: false })`;
  - actualizar la caché de ingredientes.
  - Alternativa más conservadora: ocultar «Quitar» en ingredientes y dejar sólo
    «Ajustar stock».

---

## 6. Tests

**Archivo:** `comi-rapi-backend/lib/controllers/stock_controller.test.js`
(o un nuevo `ingrediente_stock_controller.test.js`).

Casos:

1. `PUT { ajuste: 2.5 }` sobre 10 → 12.5.
2. `PUT { ajuste: -20 }` sobre 3 → 0 (nunca negativo).
3. `PUT { ajuste: 0 }` → 400.
4. `PUT { cantidad: 5, ajuste: 1 }` → 400.
5. `PUT { ajuste: -1 }` con un admin de otra sucursal → 403/404 según scoping.
6. `PUT { cantidad: -1 }` → 400 (comportamiento actual).
7. Un ajuste de ingrediente actualiza la cantidad derivada de un producto con
   receta (si el fixture lo permite).

No hay runner de tests en el frontend; la verificación de UI es manual.

---

## 7. Criterios de aceptación

- [ ] El botón aparece sólo en filas de ingredientes, al lado de «Quitar».
- [ ] Abre el modal simple de la app con foco en la cantidad.
- [ ] **+ Sumar** suma la cantidad al stock actual.
- [ ] **− Restar** resta y clampea en 0.
- [ ] Se aceptan decimales con hasta 3 posiciones.
- [ ] La fila se actualiza sin recargar toda la tabla.
- [ ] Los productos/combos derivados se resincronizan.
- [ ] Un error queda visible dentro del modal.
- [ ] No cambia el comportamiento de productos ni insumos.
- [ ] «Quitar» en ingredientes deja de romperse (o se oculta, según decisión).

---

## 8. Estimación

| Tarea                                        | Estimación |
| -------------------------------------------- | ---------- |
| Service + tests de ajuste relativo           | 1 h        |
| Modal reutilizable                           | 1.5 h      |
| Integración en `GestionStock` + correcciones | 1 h        |
| QA manual (sumar, restar, clamp, decimales)  | 0.5 h      |
| **Total**                                    | **~4 h**   |

---

## 9. Decisiones pendientes

1. **Interacción:** ¿footer con **− Restar / + Sumar** (mockup) o stepper con un
   único **Aplicar**?
2. **«Quitar» en ingredientes:** ¿se corrige para dejarlo en 0 / no disponible,
   o se oculta?
3. **Alcance:** ¿sólo ingredientes o también se agrega el ajuste a insumos?
