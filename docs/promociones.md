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
- `PedidoPromocion.descuentoAplicado` es snapshot histórico: se calcula al confirmar el pedido y nunca se reconstruye desde el catálogo.
