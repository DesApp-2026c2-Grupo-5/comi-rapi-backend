# Promociones — semántica de `valor`

Fuente de verdad estructural: `docs/DER.md` (2.16–2.18) y `docs/modelo-dominio.md` (5.14–5.16).

## Tipos (`Promocion.tipo`)

| Tipo                   | Significado                                                                  | `valor`                                              |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `DESCUENTO_PORCENTUAL` | % de descuento sobre el precio (0–100)                                       | Porcentaje a descontar                               |
| `DOS_POR_UNO`          | 2x1 literal: llevás 2 del mismo producto, pagás 1 (2ª unidad gratis por par) | Se guarda `50.00` por convención; el motor lo ignora |

## Reglas

- 3x1, 3x2 y demás NxM quedan **afuera** por ahora (requieren cambio de modelo).
- Sin cupones, envío gratis ni reglas por sucursal (exclusiones del modelo).
- `PromocionProducto` define qué productos alcanza cada promo (`UNIQUE` por par).
- **Un combo no puede ser alcanzado por una promoción**: su precio ya es la
  promoción respecto de sus componentes, así que no baja de precio aunque una
  promoción alcance al combo o a alguno de sus componentes. El combo es la
  promoción. Se rechaza al vincular (`POST /promociones/:id/productos`) y una
  promo que solo alcanzaría a combos no aplica al pedido.
- `PedidoPromocion.descuentoAplicado` es snapshot histórico: se calcula al confirmar el pedido y nunca se reconstruye desde el catálogo.

## Motor de aplicación (carrito → pedido)

- Fuente de verdad: backend (`lib/services/promociones.js`, usado por `POST /pedidos`).
  El frontend (`src/utils/calculoPromociones.js`) es espejo solo para preview.
- El cliente envía `promocionIds` al crear el pedido. Cada promo se valida:
  existe, `activa`, vigente (`fechaInicio`/`fechaFin`, null = siempre vigente)
  y alcanza ≥1 línea del pedido. Si falla, el pedido se rechaza con `400`
  (nunca se ignora en silencio).
- `total = items + envío − descuentos` (redondeado a 2 decimales).
- Si varias promos alcanzan la misma línea, gana la de mayor descuento
  (sin doble descuento). El descuento por línea nunca supera su subtotal.
- Las promos aplicadas se exponen en `GET /pedidos` y `GET /pedidos/:id`
  como `promociones: [{ promocionId, nombre, tipo, descuentoAplicado }]`.

## Ejemplos numéricos

Producto $1000, promo 10% que lo alcanza, 2 unidades:

- Items: 2 × 1000 = 2000. Descuento: 10% de 2000 = 200. Total: 1800.

Papas $900, 2x1 que las alcanza, 4 unidades:

- Items: 4 × 900 = 3600. Gratis: floor(4/2) × 900 = 1800. Total: 1800.

2x1 con cantidad impar (3 × $900):

- Gratis: floor(3/2) × 900 = 900. Total: 2700 − 900 = 1800.

Doble alcance (10% vs 2x1 sobre 2 × $1000):

- 10% = 200, 2x1 = 1000 → se aplica 2x1. Total: 1000.

Combo con un componente en promoción (Combo $21900, promo 10% sobre las Papas):

- El combo no se descuenta: se pagan los 21900 enteros. Si además se pide 1 Papa
  suelta, esa línea sí recibe el 10%.
