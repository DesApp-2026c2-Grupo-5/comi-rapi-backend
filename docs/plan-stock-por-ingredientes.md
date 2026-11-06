# Plan de implementación — Stock por ingredientes

**Proyecto:** Comi-Rapi / DesApp 2026c2 — Grupo 5  
**Fecha:** 2026-11-06  
**Estado:** plan aprobado, pendiente de implementación  
**Alcance:** backend + frontend  
**Tarjeta Trello:** `6ae4b507abb23e0c3c503bae`  
**Checklist Trello:** `6aeb642d990d78a16fa94c76`

---

## 1. Objetivo

Reemplazar la carga manual del stock de productos por una cadena derivada:

```text
IngredienteStock
      ↓  receta del producto
Stock del producto (derivado)
      ↓  receta del combo
Stock del combo (derivado)
```

El stock real pasa a estar en los ingredientes. El admin de la sucursal carga cantidades de ingredientes; el sistema calcula automáticamente las unidades disponibles de productos y combos.

Los **insumos** (extras y condimentos) siguen siendo independientes y mantienen su propio stock editable.

---

## 2. Decisiones cerradas

1. **Receta obligatoria para todo `PRODUCTO`.** No hay fallback manual. Un producto sin receta tiene cantidad derivada `0` y no es vendible.
2. **La receta de stock es independiente del campo viejo “Ingredientes” (`personalizar`).** Ese campo deja de cargarse a mano y pasa a generarse desde la receta.
3. **`Ingrediente` / `IngredienteStock` se suman, no reemplazan a `Insumo` / `InsumoStock`.**
4. **Cantidades decimales** con `DECIMAL(12,3)`.
5. **Unidades admitidas:** `unidad`, `g`, `kg`, `ml`, `l`. Sin conversión automática entre unidades.
6. **La unidad pertenece al ingrediente.** `ProductoIngrediente.cantidad` se expresa en esa misma unidad; no tiene unidad propia.
7. **La unidad no se puede cambiar** si el ingrediente ya tiene stock o recetas cargadas.
8. **Los combos no cambian su modelo.** Siguen derivando de `ComboComponente`. Un combo puede contener productos que a su vez tengan receta de ingredientes.
9. **El stock de productos y combos es de solo lectura en cantidad.** El admin solo puede cambiar `disponible`.
10. **El campo viejo “Ingredientes” desaparece del formulario de producto.** El detalle y las opciones “Sin X” se generan desde la receta.
11. **`permiteQuitar`** es un checkbox por ingrediente de la receta. Define si aparece como “Sin X”.
12. **`personalizar` deja de ser una categoría editable del ABM.** Sigue existiendo como tipo interno generado por la receta.
13. **Seeder/backfill demo** para los 23 productos simples existentes.
14. **Un commit por subtarea** y tildado del ítem en Trello al terminar.

---

## 3. Modelo de datos

### 3.1 `Ingrediente`

| Campo                     | Tipo       | Restricciones                                  |
| ------------------------- | ---------- | ---------------------------------------------- |
| `id`                      | INTEGER    | PK, autoincrement                              |
| `nombre`                  | STRING     | obligatorio, único (sin distinguir mayúsculas) |
| `unidadMedida`            | ENUM       | `unidad`, `g`, `kg`, `ml`, `l`                 |
| `activo`                  | BOOLEAN    | default `true`                                 |
| `createdAt` / `updatedAt` | timestamps | Sequelize                                      |

Reglas:

- No se puede repetir nombre.
- No se puede cambiar `unidadMedida` si existe al menos una fila de stock o de receta que lo use.
- La baja es lógica (`activo = false`).

### 3.2 `IngredienteStock`

| Campo           | Tipo          | Restricciones                   |
| --------------- | ------------- | ------------------------------- |
| `sucursalId`    | INTEGER       | PK parte, FK → `Sucursal.id`    |
| `ingredienteId` | INTEGER       | PK parte, FK → `Ingrediente.id` |
| `cantidad`      | DECIMAL(12,3) | `>= 0`, default `0`             |
| `disponible`    | BOOLEAN       | default `true`                  |

Reglas:

- PK compuesta `(sucursalId, ingredienteId)`.
- `disponible = false` equivale a `0` para el cálculo y la venta.
- Un ingrediente inactivo equivale a `0`.
- Sin fila en la sucursal equivale a `0`.

### 3.3 `ProductoIngrediente`

| Campo           | Tipo          | Restricciones                   |
| --------------- | ------------- | ------------------------------- |
| `productoId`    | INTEGER       | PK parte, FK → `Producto.id`    |
| `ingredienteId` | INTEGER       | PK parte, FK → `Ingrediente.id` |
| `cantidad`      | DECIMAL(12,3) | `> 0`                           |
| `permiteQuitar` | BOOLEAN       | default `true`                  |

Reglas:

- PK compuesta `(productoId, ingredienteId)`.
- Solo aplica a productos `PRODUCTO`; un `COMBO` no tiene receta de ingredientes.
- `cantidad` es la cantidad necesaria para **una unidad** del producto.
- No se permiten ingredientes repetidos.
- `permiteQuitar` controla la generación de opciones “Sin X”.

### 3.4 Relaciones nuevas

```text
Sucursal 1:N IngredienteStock
Ingrediente 1:N IngredienteStock

Producto 1:N ProductoIngrediente
Ingrediente 1:N ProductoIngrediente

ProductoIngrediente N:1 Ingrediente
ProductoIngrediente N:1 Producto
```

### 3.5 Cambio opcional de compatibilidad

Agregar a `PersonalizacionElementos`:

| Campo           | Tipo    | Restricciones                                         |
| --------------- | ------- | ----------------------------------------------------- |
| `ingredienteId` | INTEGER | nullable, FK → `Ingrediente.id`, `ON DELETE SET NULL` |

Se usa solo en filas `tipo = 'personalizar'` generadas desde la receta. Permite trazabilidad y evita depender del nombre.

---

## 4. Migraciones

Orden:

1. `create-ingredientes`
2. `create-ingrediente-stocks`
3. `create-producto-ingredientes`
4. `add-ingrediente-id-personalizacion-elementos` (si se aprueba el campo de compatibilidad)
5. `clean-personalizacion-categorias-personalizar` (elimina o desactiva plantillas viejas)

Consideraciones:

- `IngredienteStocks.cantidad` con CHECK `>= 0`.
- `ProductoIngredientes.cantidad` con CHECK `> 0`.
- FKs con `ON DELETE CASCADE` para `IngredienteStock` y `ProductoIngrediente`.
- Índices por `ingredienteId`, `productoId` y `sucursalId`.
- `down` completo para cada migración.

---

## 5. Fórmula de derivación

### 5.1 Producto simple

```text
unidades posibles = floor(stock ingrediente / cantidad de la receta)
stock del producto = min(unidades posibles de cada ingrediente)
```

- Si el ingrediente está inactivo, no tiene fila en la sucursal o `disponible = false`, aporta `0`.
- Si la receta está vacía, el producto tiene stock `0` y no es vendible.
- Se redondea hacia abajo: no se venden unidades incompletas.

### 5.2 Combo

```text
stock del combo = min(floor(stock producto componente / cantidad del combo))
```

- Se mantiene la fórmula actual de `maximoDeCombosDeReceta`.
- El combo primero necesita que sus componentes tengan stock derivado actualizado.

### 5.3 Orden de sincronización

Cuando cambia el stock de un ingrediente:

1. Buscar los productos simples que usan ese ingrediente.
2. Recalcular y actualizar `Stock.cantidad` de esos productos.
3. Buscar los combos que usan esos productos.
4. Recalcular y actualizar `Stock.cantidad` de esos combos.
5. Emitir `stock_actualizado` con `ingredienteIds` y `productoIds`.

Cuando cambia una receta:

1. Recalcular el producto.
2. Recalcular los combos que lo usan.

---

## 6. Backend — API

### 6.1 Catálogo de ingredientes

| Método   | Ruta                    | Rol             | Descripción                |
| -------- | ----------------------- | --------------- | -------------------------- |
| `GET`    | `/api/ingredientes`     | Público / admin | Lista ingredientes activos |
| `GET`    | `/api/ingredientes/:id` | Público / admin | Detalle                    |
| `POST`   | `/api/ingredientes`     | Superadmin      | Alta                       |
| `PUT`    | `/api/ingredientes/:id` | Superadmin      | Edición                    |
| `DELETE` | `/api/ingredientes/:id` | Superadmin      | Baja lógica                |

Validaciones:

- nombre obligatorio y único;
- unidad válida;
- no cambiar unidad si está en uso;
- no borrar físicamente un ingrediente con stock o recetas.

### 6.2 Stock de ingredientes por sucursal

| Método | Ruta                                     | Rol                             | Descripción                                           |
| ------ | ---------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/stock/ingredientes`                | Admin / superadmin con contexto | Lista ingredientes con stock de la sucursal operativa |
| `PUT`  | `/api/stock/ingredientes/:ingredienteId` | Admin / superadmin con contexto | Actualiza `cantidad` y/o `disponible`                 |

Reglas:

- El `sucursalId` sale de la sesión, no de la URL.
- El `GET` crea las filas faltantes en 0 para que el admin vea el catálogo completo.
- `PUT` valida cantidad `>= 0` y respeta la unidad del ingrediente.
- Al guardar, dispara la sincronización derivada y el evento `stock_actualizado`.

### 6.3 Vista previa de receta

| Método | Ruta                            | Rol                | Descripción                                                |
| ------ | ------------------------------- | ------------------ | ---------------------------------------------------------- |
| `POST` | `/api/stock/maximos-de-recetas` | Admin / superadmin | Devuelve el máximo producible por sucursal para una receta |

Body:

```json
{
  "ingredientes": [
    { "ingredienteId": 1, "cantidad": 20 },
    { "ingredienteId": 2, "cantidad": 150 }
  ]
}
```

Respuesta:

```json
{
  "success": true,
  "data": [
    {
      "sucursalId": 1,
      "sucursal": "Sucursal Centro",
      "maximo": 30,
      "detalle": [
        {
          "ingredienteId": 1,
          "ingrediente": "Tomate",
          "unidadMedida": "g",
          "seNecesitan": 20,
          "hay": 1000
        }
      ]
    }
  ]
}
```

### 6.4 Producto con receta

`POST /api/productos` y `PUT /api/productos/:id` aceptan:

```json
{
  "nombre": "Hamburguesa Clásica",
  "precio": 9800,
  "categoriaId": 1,
  "tipo": "PRODUCTO",
  "recetaIngredientes": [
    { "ingredienteId": 1, "cantidad": 1, "permiteQuitar": false },
    { "ingredienteId": 2, "cantidad": 150, "permiteQuitar": false },
    { "ingredienteId": 3, "cantidad": 20, "permiteQuitar": true }
  ]
}
```

Validaciones:

- `PRODUCTO` nuevo: receta obligatoria con al menos un ingrediente.
- `PRODUCTO` existente: si se envía `recetaIngredientes`, se reemplaza completa; si no se envía, se conserva la actual. Al final, el producto debe tener al menos un ingrediente.
- `recetaIngredientes: []` se rechaza para `PRODUCTO`.
- ingrediente existente y activo;
- cantidad `> 0`;
- sin ingredientes repetidos;
- `COMBO` no acepta `recetaIngredientes`.

`GET /api/productos/:id` y los listados que lo necesiten devuelven:

```json
{
  "recetaIngredientes": [
    {
      "ingredienteId": 1,
      "nombre": "Pan de hamburguesa",
      "unidadMedida": "unidad",
      "cantidad": 1,
      "permiteQuitar": false
    }
  ]
}
```

El campo viejo `ingredientes` (lista de nombres) se deja de usar. Para compatibilidad durante el despliegue se acepta pero se ignora.

### 6.5 Stock de productos y combos

- `GET /api/stock` devuelve la cantidad derivada para `PRODUCTO` con receta y para `COMBO`.
- `GET /api/stock/:sucursalId/:productoId/disponibilidad` devuelve la cantidad derivada.
- `PUT /api/stock/:sucursalId/:productoId` ignora `cantidad` para productos con receta y combos; solo permite `disponible`.
- `POST /api/stock/:sucursalId/:productoId` crea la fila con la cantidad derivada inicial, no con 0.
- `stock_actualizado` incluye `ingredienteIds` y todos los `productoIds` afectados.

---

## 7. Pedidos y stock

### 7.1 Ingredientes requeridos por un pedido

Nueva función:

```text
ingredientesDeLineas(items) → Map<ingredienteId, cantidadTotal>
```

Reglas:

- Para cada línea, tomar el producto y su receta.
- Multiplicar cada cantidad de receta por las unidades pedidas.
- Si el producto es `COMBO`, sumar la receta de cada producto componente.
- Si un mismo ingrediente aparece en varios productos, sumar una sola vez por ingrediente.
- Los ítems históricos sin receta se ignoran.

### 7.2 Faltantes

- `faltantesDeIngredientes(items, sucursalId)`:
  - busca `Ingrediente`, `IngredienteStock` y recetas;
  - un ingrediente inactivo, sin fila o no disponible cuenta como `0`;
  - devuelve `{ tipo: 'ingrediente', ingredienteId, nombre, hay, necesario }`.
- `faltantesDeStock` suma los faltantes de producto y de ingredientes.
- `faltantesDePedido`:
  - para el cliente, un faltante de ingrediente se informa como faltante del **producto afectado**, no del ingrediente interno;
  - conserva los faltantes de insumos con `tipo: 'insumo'`.
- `mensajeDeFaltantes` contempla los ingredientes sin exponer nombres internos de la receta.

### 7.3 Descuento

`descontarStock`:

1. Valida faltantes de producto, ingredientes e insumos.
2. Descuenta `IngredienteStock` de forma atómica:

```sql
UPDATE "IngredienteStocks"
SET cantidad = cantidad - :total
WHERE "sucursalId" = :sucursalId
  AND "ingredienteId" = :ingredienteId
  AND disponible = true
  AND cantidad >= :total
```

3. Descuenta `InsumoStock` como hoy.
4. Recalcula los espejos de productos y combos desde los ingredientes.
5. Devuelve las filas afectadas para `stock_actualizado`.

La protección contra sobreventa queda en el `UPDATE ... WHERE cantidad >= total` de los ingredientes. Los espejos de producto/combo no son la fuente de verdad.

### 7.4 Reposición

`reponerStock`:

1. Repone `IngredienteStock` con `findOrCreate` para crear la fila si falta.
2. Repone `InsumoStock` como hoy.
3. Recalcula los espejos de productos y combos.
4. Devuelve las filas afectadas.

### 7.5 Reservas vencidas

`reservasDeStockVencidas`:

- si un ingrediente se desactiva, se saca de la sucursal o queda no disponible, se invalida la reserva;
- el producto afectado se informa a través del producto o combo que el cliente pidió;
- no se compara `cantidad` contra lo pedido: el pedido ya consumió sus unidades al crearse.

### 7.6 Reasignación y cancelación

- Cancelar repone ingredientes, insumos y recalcula espejos.
- Reasignar repone en la sucursal origen y descuenta en la destino, con la misma lógica.
- Los eventos `stock_actualizado` incluyen los ingredientes y productos afectados.

---

## 8. Ingredientes informativos y “Sin X”

### 8.1 Fuente única

La receta es la única fuente:

- **Detalle del producto:** muestra los nombres de `ProductoIngrediente`.
- **Modal de personalización:** muestra “Sin X” solo para ingredientes con `permiteQuitar = true`.

### 8.2 Sincronización

Al guardar la receta de un `PRODUCTO`:

1. Eliminar los `PersonalizacionElemento` de tipo `personalizar` del producto.
2. Crear una fila por cada ingrediente con `permiteQuitar = true`:
   - `productoId`;
   - `tipo = 'personalizar'`;
   - `nombre` = nombre del ingrediente;
   - `precio = null`;
   - `minimo = 0`;
   - `maximo = 1`;
   - `activo = true`;
   - `ingredienteId` (si se agrega la columna).
3. No tocar los elementos `extra`, `acompanar` ni `condimento`.

Los pedidos históricos guardan su propio snapshot, así que no se ven afectados.

### 8.3 ABM de personalización

Se retira `personalizar` del ABM editable:

- **Por producto:** se quita la pestaña/filtro y el alta de `personalizar`.
- **Por categoría:** se quita la pestaña/filtro y el tipo del formulario.
- **Backend:** se rechaza el alta/edición manual de `personalizar` desde los controllers del ABM.
- **Modelo:** el enum y la API `GET /api/personalizacion` siguen existiendo porque el cliente los consume.

El ABM queda con tres categorías editables:

```text
Extra · Acompaña · Condimentos
```

Las plantillas `personalizar` de categoría ya no se heredan (`TIPOS_NO_HEREDADOS`). Se eliminan o desactivan en la migración de limpieza.

---

## 9. Seeder / backfill demo

### 9.1 Ingredientes iniciales

Catálogo demo con unidades base:

- sólidos en `g`: tomate, lechuga, carne, cheddar, bacon, papa, harina, chocolate, etc.;
- líquidos en `ml`: leche, salsa, aceite, café, jarabes;
- contables en `unidad`: pan, huevo, masa, feta.

### 9.2 Stock inicial

Cargar cantidades por sucursal que permitan operar el catálogo demo. No se busca preservar exactamente las cantidades manuales viejas: la primera sincronización reemplaza `Stock.cantidad` por el derivado.

### 9.3 Recetas

Cargar recetas para los 23 productos simples actuales:

- Bebidas: Caramel Frappuccino, Coca-Cola 500ml, Limonada Natural, Pumpkin Spice Latte, The Pink Drink.
- Hamburguesas: Cheddar Bacon, Clásica, Doble, Royale con Queso & Pepinillos.
- Papas: Kimchi Coreanas, Cheddar, Fritas Grandes.
- Pizzas: Cuatro Quesos, Fugazzeta, Muzzarella, Napolitana, Pepperoni & Miel Picante.
- Postres: Cheesecake, Hamburguesa Dulce, Lava Cake, New York Cheesecake, Tarta Rogel, Volcán de Chocolate.

Cada receta define `permiteQuitar` de forma realista:

- `true` para verduras, salsas y agregados;
- `false` para pan, masa, carne, harina y bases estructurales.

### 9.4 Idempotencia

- Buscar por nombre antes de crear.
- No duplicar filas de stock ni recetas.
- No pisar datos existentes si el seeder se corre dos veces.
- Al finalizar, sincronizar cantidades de productos y combos.

---

## 10. Frontend

### 10.1 FE-1 — ABM de ingredientes

Nuevo:

- `src/api/ingredientes.js`
- `src/pages/superadmin/GestionIngredientes.jsx`
- ruta `/superadmin/ingredientes`
- link en el navbar

Funcionalidad:

- listar, crear, editar y dar de baja;
- campos: nombre, unidad de medida, activo;
- validaciones y confirmación de baja;
- aviso si el ingrediente está en uso y no se puede cambiar la unidad.

### 10.2 FE-2 — Editor de receta

Nuevo componente:

- `src/components/admin/EditarRecetaIngredientes.jsx`

Se integra en `FormularioProducto.jsx` solo para `PRODUCTO`.

Contenido:

- selector de ingrediente;
- cantidad;
- unidad de solo lectura;
- checkbox `permiteQuitar`;
- botón agregar/eliminar fila;
- validación de mínimo una fila, sin repetidos y cantidad `> 0`;
- modal para buscar y agregar ingrediente;
- link a `/superadmin/ingredientes` si falta un ingrediente;
- vista previa de unidades producibles por sucursal.

El textarea viejo “Ingredientes” se elimina.

### 10.3 FE-3 — GestionStock

- Nuevo filtro **Ingredientes** inmediatamente a la derecha de **Insumos**:

```text
Todos | Productos | Combos | Insumos | Ingredientes
```

- Pestaña con tabla de ingredientes:
  - nombre;
  - unidad;
  - cantidad editable;
  - disponibilidad;
  - estado.
- Para productos: cantidad derivada de solo lectura y badge “Derivada de receta”.
- Para combos: se mantiene el comportamiento actual.
- Refresco por `stock_actualizado`.
- No mezclar ingredientes con la tabla de productos.

### 10.4 FE-4 — Detalle de producto

- Para `PRODUCTO`, la sección **Ingredientes** usa `recetaIngredientes`.
- Para `COMBO`, sigue mostrando los componentes.
- El modal “Personalizar” sigue usando `PersonalizacionElemento`; las opciones “Sin X” provienen de la receta.
- Si la receta no tiene ingredientes con `permiteQuitar`, no se muestra el grupo “Personalizar”.

### 10.5 FE-5 — ABM de personalización

- Quitar la pestaña/filtro **Personalizar** de:
  - `GestionPersonalizacion.jsx`;
  - `GestionPersonalizacionCategorias.jsx`.
- Quitar `personalizar` del selector de tipo de `FormularioPersonalizacion.jsx`.
- Actualizar contadores y textos.
- Reemplazar el ejemplo “Sin Hielo” por uno válido de Extra/Acompaña/Condimento.
- Mantener el tipo en `constants` y en el contexto del cliente.

---

## 11. Subtareas y commits

| ID   | Subtarea                                   | Commit sugerido                                          |
| ---- | ------------------------------------------ | -------------------------------------------------------- |
| BE-1 | Documentar modelo y DER                    | `docs(stock): documentar ingredientes y recetas`         |
| BE-2 | Migraciones, modelos y asociaciones        | `feat(stock): agregar modelos de ingredientes y recetas` |
| BE-3 | Catálogo de ingredientes                   | `feat(stock): agregar ABM de ingredientes`               |
| BE-4 | Receta en producto + informativos          | `feat(productos): guardar receta de ingredientes`        |
| BE-5 | Derivación y endpoints de stock            | `feat(stock): derivar stock desde recetas`               |
| BE-6 | Pedidos: faltantes, descuento y reposición | `feat(pedidos): integrar ingredientes en stock`          |
| BE-7 | Seeder/backfill demo                       | `chore(seed): cargar ingredientes y recetas demo`        |
| BE-8 | Retirar personalizar del ABM manual        | `refactor(personalizacion): generar Sin X desde receta`  |
| FE-1 | API client y ABM de ingredientes           | `feat(admin): agregar ABM de ingredientes`               |
| FE-2 | Editor de receta                           | `feat(productos): agregar editor de receta`              |
| FE-3 | Filtro Ingredientes en stock               | `feat(stock): agregar stock de ingredientes`             |
| FE-4 | Detalle desde receta                       | `feat(producto): mostrar ingredientes desde receta`      |
| FE-5 | Quitar Personalizar del ABM                | `refactor(personalizacion): quitar personalizar del ABM` |

Orden de implementación:

```text
BE-1 → BE-2 → BE-3 → BE-4 → BE-5 → BE-6 → BE-7 → BE-8
→ FE-1 → FE-2 → FE-3 → FE-4 → FE-5
```

---

## 12. Pruebas

### Backend

- Unitarias de fórmula:
  - tomate 1000 g / 20 g = 50;
  - leche 1250 ml / 200 ml = 6;
  - harina 2750 g / 250 g = 11;
  - ingrediente inactivo, sin fila o no disponible = 0;
  - mínimo entre varios ingredientes.
- Servicio de catálogo:
  - nombre obligatorio;
  - unidad inválida;
  - duplicados;
  - cambio de unidad bloqueado si está en uso.
- Receta:
  - alta obligatoria;
  - cantidad `> 0`;
  - sin repetidos;
  - combo rechaza receta;
  - reemplazo completo.
- Stock:
  - derivación de producto;
  - sincronización de combos;
  - cantidad read-only;
  - evento `stock_actualizado`.
- Pedidos:
  - faltantes de ingredientes;
  - descuento atómico;
  - reposición;
  - cancelación;
  - reasignación;
  - reservas vencidas.
- Integración con base real.

### Frontend

- `npm run build`.
- Prueba manual de:
  - alta de ingrediente;
  - carga de receta;
  - vista previa;
  - stock por sucursal;
  - detalle de producto;
  - “Sin X”;
  - ABM sin Personalizar.

---

## 13. Comandos de verificación

Backend:

```powershell
cd comi-rapi-backend
npm test -- <archivo>
npm run build
```

Migraciones de test:

```powershell
$env:NODE_ENV='test'
npx sequelize-cli db:migrate
```

Base de desarrollo:

```powershell
npx sequelize-cli db:migrate
npx sequelize-cli db:seed --seed <seeder>
```

Frontend:

```powershell
cd comi-rapi-fronted
npm run build
```

Recordatorio: el backend corre desde `dist/`. Después de `npm run build` hay que reiniciar el proceso.

---

## 14. Riesgos y consideraciones

1. **El stock manual viejo de productos deja de ser la fuente de verdad.** La primera sincronización lo reemplaza por el derivado.
2. **Productos sin receta quedan bloqueados.** El seeder debe ejecutarse antes de vender.
3. **Cambio de unidad.** Bloquearlo si el ingrediente está en uso.
4. **Decimales.** Usar `DECIMAL(12,3)` y redondear solo al calcular unidades vendibles.
5. **Concurrencia.** La protección contra sobreventa está en el `UPDATE` atómico de `IngredienteStock`.
6. **Combos.** No se anidan combos; la derivación es producto → combo.
7. **Datos históricos.** Los pedidos guardan snapshot; no se recalculan.
8. **Compatibilidad.** `personalizar` sigue en el enum y en la API de lectura aunque no sea editable en el ABM.
9. **Insumos.** No forman parte de la receta; mantienen su stock independiente.
10. **“Sin X”.** No modifica el descuento de stock: se descuenta la receta completa. Si se quiere descontar menos, es una regla futura separada.

---

## 15. Criterios de aceptación

- [ ] Un `PRODUCTO` no se puede crear sin receta.
- [ ] Un `PRODUCTO` con receta muestra cantidad derivada y de solo lectura.
- [ ] Un `COMBO` sigue derivando de sus componentes.
- [ ] El admin carga stock de ingredientes por sucursal.
- [ ] El admin no puede editar la cantidad de productos ni combos.
- [ ] El detalle del producto muestra los ingredientes de la receta.
- [ ] “Sin X” se genera desde los ingredientes con `permiteQuitar`.
- [ ] El ABM de personalización ya no permite administrar `personalizar`.
- [ ] Un pedido descuenta y repone ingredientes de forma atómica.
- [ ] Los faltantes de ingredientes se informan correctamente.
- [ ] El seeder deja operable el catálogo demo.
- [ ] Pasan los tests y los builds de backend y frontend.

---

## 16. Estado de avance

| Subtarea | Estado     |
| -------- | ---------- |
| BE-1     | Completado |
| BE-2     | Completado |
| BE-3     | Completado |
| BE-4     | Completado |
| BE-5     | Completado |
| BE-6     | Completado |
| BE-7     | Pendiente  |
| BE-8     | Pendiente  |
| FE-1     | Pendiente  |
| FE-2     | Pendiente  |
| FE-3     | Pendiente  |
| FE-4     | Pendiente  |
| FE-5     | Pendiente  |

Este archivo se actualiza al cerrar cada subtarea, marcando el estado y agregando las decisiones o desvíos que hayan surgido durante la implementación.

## 17. Registro de implementación

- **BE-1 (completado):** `modelo-dominio.md` y `DER.md` documentan `Ingrediente`
  (unidad `unidad`/`g`/`kg`/`ml`/`l`), `IngredienteStock`
  `(sucursalId, ingredienteId)` con `DECIMAL(12,3) >= 0` y `ProductoIngrediente`
  `(productoId, ingredienteId)` con `cantidad > 0` y `permiteQuitar`. Se
  actualizaron entidades, relaciones, claves, reglas y el mermaid.
- **BE-2 (completado):** migraciones `20261106000001-create-ingredientes`,
  `20261106000002-create-ingrediente-stocks`,
  `20261106000003-create-producto-ingredientes` y
  `20261106000004-add-ingrediente-id-personalizacion-elementos`; modelos
  `Ingrediente`, `IngredienteStock` y `ProductoIngrediente` con sus
  asociaciones. El nombre del ingrediente es único con un índice funcional sobre
  `LOWER(nombre)`. Tests de modelo en `lib/models/ingrediente.test.js`.
- **BE-3 (completado):** service `lib/services/ingredientes_catalogo.js`,
  controller y rutas `/api/ingredientes` (lectura pública de activos, escritura
  SUPERADMINISTRADOR). El alta crea filas de stock en 0 para las sucursales
  activas; la unidad se bloquea si hay stock positivo o recetas. Tests en
  `lib/controllers/ingrediente_controller.test.js`. El `lib/services/ingredientes.js`
  viejo se conserva para la sincronización de "Sin X" de BE-4.
- **BE-4 (completado):** receta obligatoria en productos, sincronización de "Sin X" desde la receta, `recetaIngredientes` en GET/POST/PUT, tests actualizados.
- **BE-5 (completado):** endpoints `/api/stock/ingredientes`, `/api/stock/maximos-de-recetas`; derivación de `Stock.cantidad` de productos simples y combos desde ingredientes; inicialización de stock en el alta; sincronización en cambios de stock y receta.
- **BE-6 (completado):** integración de ingredientes en `faltantesDeStock`, `faltantesDePedido`, `descontarStock` (descuento atómico de `IngredienteStock`) y `reponerStock`; sincronización de productos y combos afectados.
