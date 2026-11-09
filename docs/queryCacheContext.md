# Contexto: Caché de consultas con TanStack Query v5

Fecha: 2026-11-07
Archivo: `comi-rapi-backend/docs/queryCacheContext.md`
Estado: **documento vivo** — se actualiza al cerrar cada parte de la implementación.

---

## 1. Propósito

Este documento describe la arquitectura de caché de consultas en el frontend (Comi-Rapi Fronted) usando **TanStack Query v5** (React Query). Cubre:

- Organización de queryKeys (públicas vs privadas)
- Políticas de `staleTime`, `refetchOnReconnect`, `placeholderData`
- Integración con Socket.IO para invalidación en tiempo real
- Patrones correctos e incorrectos para listas con datos iniciales (bootstrap)

---

## 2. Principio rector

> **La caché es la fuente de verdad de la UI. El backend es la fuente de verdad de los datos. El socket solo avisa que hay datos nuevos; la caché los trae por REST y actualiza la vista sin recargar.**

Consecuencias:

- Un evento de socket perdido **no corrompe** la UI: la próxima invalidación (reconexión, foco de ventana, mutación) traerá datos frescos.
- `staleTime: Infinity` (o 20 min) evita refetches innecesarios; la invalidación explícita controla cuándo refrescar.
- `placeholderData` permite render inmediato sin skeleton mientras el fetch en background actualiza.

---

## 3. Organización de queryKeys

### 3.1 Convención de namespaces

```js
export const queryKeys = {
  public: {
    // Catálogo, parámetros, sucursales, reseñas públicas
    // No dependen de la sesión. El logout NO las limpia.
    all: ['public'],
    parametros: ['public', 'parametros'],
    categorias: (incluirInactivas = false) => [
      'public',
      'categorias',
      incluirInactivas ? 'todas' : 'activas',
    ],
    categoria: (id) => ['public', 'categorias', 'detalle', String(id)],
    productos: (opciones) => [
      'public',
      'productos',
      'lista',
      claveProductos(opciones),
    ],
    producto: (id) => ['public', 'productos', 'detalle', String(id)],
    // ...
  },
  private: {
    // Pedidos, perfil, stock, reportes, administradores
    // Dependen de la sesión. El logout las limpia con:
    // queryClient.removeQueries({ queryKey: ['private'] })
    all: ['private'],
    pedidos: (filtros) => ['private', 'pedidos', filtros],
    stock: ['private', 'stock'],
    // ...
  },
};
```

**Reglas:**

- Claves primitivas (strings, numbers) — **no objetos** — para estabilidad entre renders y fácil invalidación por prefijo.
- `exact: false` en `invalidateQueries` para cubrir todas las variantes de una lista (ej. `['public', 'categorias']` invalida `activas`, `todas`, y futuras variantes).
- El bootstrap siembra bajo `['public', 'bootstrap']` y los hooks leen de ahí como `placeholderData` inicial.

---

## 4. Políticas de consulta por tipo de dato

| Tipo de dato                | Hook(s)                                                                                                                    | `staleTime`                      | `refetchOnReconnect`              | `placeholderData`                      | Invalidación                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Listas de catálogo**      | `useProductos`, `useCategorias`, `usePromociones`, `useMasVendidos`, `useInsumosQuery`, `useElementosPersonalizacionQuery` | 20 min (`TIEMPO_CACHE_QUERY_MS`) | `false` (RealtimeBridge invalida) | Datos de bootstrap o caché previa      | `CATALOGO_ACTUALIZADO`, `INSUMO_CATALOGO_ACTUALIZADO`, `PERSONALIZACION_*_ACTUALIZADO` → prefix `['public', ...]` |
| **Detalle de catálogo**     | `useProducto`, `useCategoria`, `usePromocion`, `useElementoPersonalizacionQuery`, `usePlantillaPersonalizacionQuery`       | 20 min                           | `false`                           | Dato de lista/base/bootstrap si existe | Mismo evento + queryKey exacta con `id`                                                                           |
| **Parámetros**              | `useParametros`                                                                                                            | 20 min                           | `false`                           | Bootstrap                              | `PARAMETROS_ACTUALIZADOS`                                                                                         |
| **Stock**                   | `useStockListaQuery`                                                                                                       | 20 min                           | `false`                           | Caché previa                           | `STOCK_ACTUALIZADO` (solo sucursal operativa)                                                                     |
| **Pedidos/Perfil/Reportes** | `usePedidos`, `usePerfil`, `useReportesQuery`                                                                              | 20 min / 5 min                   | `false` / según caso              | Caché previa                           | `PEDIDO_ACTUALIZADO`, mutaciones propias                                                                          |

---

## 5. Patrón correcto: Listas con datos iniciales (bootstrap)

### ✅ CORRECTO — `enabled: true` + `placeholderData`

```js
export const useCategorias = ({
  incluirInactivas = false,
  enabled = true,
  staleTime = TIEMPO_CACHE_QUERY_MS,
} = {}) => {
  const queryClient = useQueryClient();
  const clave = queryKeys.public.categorias(incluirInactivas);
  const datosBootstrap = queryClient.getQueryData(queryKeys.public.bootstrap);
  const datosExistentes =
    datosBootstrap?.categorias || queryClient.getQueryData(clave);

  return useQuery({
    queryKey: clave,
    queryFn: ({ signal }) => fetchCategorias({ incluirInactivas, signal }),
    enabled, // SIEMPRE true (salvo que el caller pase false)
    placeholderData: datosExistentes, // Render inmediato, sin skeleton
    staleTime,
    refetchOnReconnect: false, // RealtimeBridge invalida al reconectar
  });
};
```

**Por qué funciona:**

1. `enabled: true` → la consulta está **activa** y responde a `invalidateQueries`
2. `placeholderData` → muestra datos de bootstrap/caché **inmediatamente** al montar
3. Al recibir `CATALOGO_ACTUALIZADO`, `RealtimeBridge` llama:
   ```js
   queryClient.invalidateQueries({
     queryKey: ['public', 'categorias'],
     exact: false,
   });
   ```
4. TanStack Query marca _stale_ → **dispara refetch automático en background** (porque `enabled: true`)
5. Datos frescos llegan → `placeholderData` se reemplaza → UI se actualiza **sin spinner**

---

## 6. Anti-patrón: `enabled: enabled && !datosExistentes`

### ❌ INCORRECTO — Bloquea el refetch tras invalidación

```js
// ANTES (roto):
return useQuery({
  queryKey: clave,
  queryFn: fetchFn,
  enabled: enabled && !datosExistentes, // ← PROBLEMA
  placeholderData: datosExistentes,
  staleTime,
  refetchOnReconnect: false,
});
```

**Qué pasa:**

1. Primer render: `datosExistentes` viene de bootstrap → `enabled === false` → **no fetchea** (usa placeholder)
2. Llega `CATALOGO_ACTUALIZADO` → `invalidateQueries` marca _stale_
3. TanStack Query ve `enabled === false` → **NO ejecuta refetch** (la consulta está "deshabilitada")
4. La UI **nunca se actualiza** con los datos nuevos

**Síntomas:**

- Sincronización en tiempo real rota (categorías, productos, promociones no actualizan)
- Requests HTTP "cancelados" en Network al navegar a edición (la consulta invalidada intenta fetchear pero `enabled` la cancela)
- Funciona solo si el usuario hace refresh manual (F5)

---

## 7. Integración con Socket.IO: `RealtimeBridge`

### 7.1 Arquitectura

```
Backend (categoria_controller.update)
    │
    ├─ Commit en PostgreSQL
    │
    └─ emitirCatalogoActualizado({ tipo: 'categoria', id, accion: 'actualizado' })
           │
           ▼
    Socket.IO broadcast → TODOS los conectados (incl. anónimos)
           │
           ▼
Frontend: RealtimeBridge.jsx (montado en App.jsx)
           │
           ├─ Listeners PÚBLICOS (siempre):
           │   - CATALOGO_ACTUALIZADO → invalidarCatalogo()
           │   - PARAMETROS_ACTUALIZADOS → invalidarParametros()
           │   - PERSONALIZACION_ELEMENTO_ACTUALIZADO
           │   - PERSONALIZACION_PLANTILLA_ACTUALIZADO
           │   - INSUMO_CATALOGO_ACTUALIZADO
           │
           └─ Listeners PRIVADOS (solo si hay sesión):
               - STOCK_ACTUALIZADO → invalidarStock()
               - PEDIDO_ACTUALIZADO → invalidarReportes()
```

### 7.2 Handler de catálogo (ejemplo categorías)

```js
// En RealtimeBridge.jsx
const invalidarCatalogo = (queryClient, payload) => {
  const { tipo, id } = payload;

  if (tipo === 'categoria') {
    // Prefijo: invalida 'activas', 'todas', y cualquier variante futura
    queryClient.invalidateQueries({
      queryKey: ['public', 'categorias'],
      exact: false,
    });
    if (id) {
      // Detalle exacto de la categoría editada
      queryClient.invalidateQueries({
        queryKey: queryKeys.public.categoria(id),
      });
    }
    // Productos muestran nombre de categoría: invalidar lista base
    queryClient.invalidateQueries({
      queryKey: ['public', 'productos', 'lista'],
      exact: false,
    });
    // Más vendidos pueden cambiar de categoría
    queryClient.invalidateQueries({ queryKey: queryKeys.public.masVendidos });
    return;
  }
  // ... producto, promocion
};
```

### 7.3 Reconexión

```js
const desregistrarReconexion = alReconectar(instancia, () => {
  invalidarCatalogo(queryClient, {}); // fallback amplio
  invalidarParametros(queryClient);
  if (haySesion) {
    invalidarStock(queryClient, { sucursalId: sucursalOperativaId });
    invalidarReportes(queryClient, sucursalOperativaId);
  }
  // Personalización e insumos: invalidación amplia por prefijo
  queryClient.invalidateQueries({
    queryKey: ['public', 'personalizacion'],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ['public', 'insumos'],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ['public', 'productos', 'lista'],
    exact: false,
  });
});
```

---

## 8. Bootstrap: carga inicial sin requests

### 8.1 Qué es

`GET /api/bootstrap` devuelve en una sola respuesta:

```json
{
  "productos": [...],      // base (sin personalización ni reseñas)
  "categorias": [...],     // solo activas
  "promociones": [...],    // solo activas, sin productos
  "masVendidos": [...],
  "parametros": {...},
  "sucursales": [...]
}
```

### 8.2 Cómo se usa

```js
// En App.jsx o layout raíz
useEffect(() => {
  if (!queryClient.getQueryData(queryKeys.public.bootstrap)) {
    queryClient.prefetchQuery({
      queryKey: queryKeys.public.bootstrap,
      queryFn: fetchBootstrap,
      staleTime: TIEMPO_CACHE_QUERY_MS,
    });
  }
}, []);
```

Los hooks leen:

```js
const datosBootstrap = queryClient.getQueryData(queryKeys.public.bootstrap);
const datosExistentes =
  datosBootstrap?.categorias || queryClient.getQueryData(clave);
placeholderData: datosExistentes;
```

**Ventajas:**

- 1 request HTTP en lugar de 5-6 al cargar la app
- `placeholderData` disponible **antes** de que el hook se monte
- Sin skeleton, sin layout shift

---

## 9. Invalidación por prefijo (`exact: false`)

### 9.1 Por qué es necesaria

Las queryKeys de listas tienen variantes:

```js
queryKeys.public.categorias(false); // ['public', 'categorias', 'activas']
queryKeys.public.categorias(true); // ['public', 'categorias', 'todas']
```

Invalidar solo la exacta dejaría la otra _stale_. Con `exact: false`:

```js
queryClient.invalidateQueries({
  queryKey: ['public', 'categorias'],
  exact: false,
});
// Invalida AMBAS (y cualquier futura: 'public/categorias/otra-variante')
```

### 9.2 Qué se invalida por prefijo

| Evento                                  | Prefijos invalidados                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CATALOGO_ACTUALIZADO` (categoria)      | `['public', 'categorias']`, `['public', 'productos', 'lista']`                               |
| `CATALOGO_ACTUALIZADO` (producto)       | `['public', 'productos', 'lista']`, `['public', 'promociones', 'lista']`                     |
| `CATALOGO_ACTUALIZADO` (promocion)      | `['public', 'promociones', 'lista']`                                                         |
| `PERSONALIZACION_ELEMENTO_ACTUALIZADO`  | `['public', 'personalizacion']`, `['public', 'productos', 'lista']`                          |
| `PERSONALIZACION_PLANTILLA_ACTUALIZADO` | `['public', 'personalizacion', 'plantillas']`, `['public', 'productos', 'lista']`            |
| `INSUMO_CATALOGO_ACTUALIZADO`           | `['public', 'insumos']`, `['public', 'personalizacion']`, `['public', 'productos', 'lista']` |

---

## 10. Hooks de detalle: `useProducto`, `useCategoria`, etc.

Estos **sí** usan `enabled` condicional porque el detalle trae datos extra (personalización, reseñas) que la lista no tiene:

```js
export const useProducto = (
  id,
  { enabled = true, staleTime = TIEMPO_CACHE_QUERY_MS } = {}
) => {
  const queryClient = useQueryClient();
  const claveListaBase = queryKeys.public.productos({});
  const listaBase = queryClient.getQueryData(claveListaBase);
  const productoDeLista = listaBase?.find((p) => String(p.id) === String(id));
  // ... fallback a bootstrap
  const datoCompletoCache = productoDeLista ?? productoBootstrap ?? null;
  const necesitaFetchDetalle = !datoCompletoCache;

  return useQuery({
    queryKey: queryKeys.public.producto(id),
    queryFn: ({ signal }) => fetchProducto({ id, signal }),
    enabled: enabled && necesitaFetchDetalle && id,
    staleTime,
    placeholderData: datoCompletoCache, // Render inmediato con datos de lista
    refetchOnReconnect: false,
  });
};
```

- Si el producto ya está en la lista base → `placeholderData` con datos de lista, **no fetchea** (ahorra request)
- Si no está → fetchea el detalle completo
- Al invalidar `CATALOGO_ACTUALIZADO` → la lista base se refetchea → el detalle se actualiza vía `placeholderData` o nueva invalidación de su queryKey exacta

---

## 11. Limpieza al logout

```js
// En AuthContext o useLogout
const logout = async () => {
  await apiLogout();
  queryClient.removeQueries({ queryKey: ['private'] }); // Solo árbol privado
  // ['public'] se conserva: catálogo, parámetros, sucursales siguen válidos
};
```

**Por qué no limpiar `public`:**

- Datos de catálogo son públicos y compartidos entre sesiones
- Evita refetch innecesario al volver a loguearse
- `staleTime` + invalidación por socket mantienen frescura

---

## 12. Tests y verificación

### 12.1 Tests relevantes

- `lib/realtime/conexion.test.js` — 29 tests: handshake anónimo, broadcast, rooms, reconexión
- `lib/controllers/*_controller.test.js` — emiten `catalogo_actualizado` tras create/update/destroy
- Frontend: build + ESLint + tests de hooks (si existen)

### 12.2 Verificación manual

1. Abrir SUPERADMIN en pestaña 1 (`/superadmin/categorias`)
2. Abrir CLIENTE en pestaña 2 (`/cliente/catalogo`) — **sin sesión** (anónimo)
3. Editar una categoría en pestaña 1
4. Verificar:
   - Backend emite `catalogo_actualizado` (logs)
   - Pestaña 2 recibe evento (Network → WS → Messages)
   - `RealtimeBridge` invalida `['public', 'categorias']`
   - `useCategorias` refetchea en background
   - UI de pestaña 2 muestra el nombre nuevo **sin refresh manual**

---

## 13. Archivos clave

### Frontend

| Archivo                                     | Responsabilidad                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `src/hooks/queries/queryKeys.js`            | Definición de todas las claves (público/privado)                           |
| `src/hooks/queries/useCatalogo.js`          | Hooks de lista y detalle: productos, categorías, promociones, más vendidos |
| `src/hooks/queries/useGestion.js`           | Hooks de gestión: insumos, personalización, stock, reportes                |
| `src/hooks/queries/fetchers.js`             | Funciones de fetch (`fetchCategorias`, `fetchProductos`, etc.)             |
| `src/components/comunes/RealtimeBridge.jsx` | **Centraliza listeners de socket**; invalida queryKeys en eventos          |
| `src/services/socket.js`                    | Singleton Socket.IO, conexión, eventos                                     |
| `src/context/AuthContext.jsx`               | Limpieza de `private` al logout                                            |

### Backend

| Archivo                                   | Responsabilidad                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `lib/realtime/index.js`                   | Emisores: `emitirCatalogoActualizado`, `emitirParametrosActualizados`, etc. |
| `lib/realtime/conexion.js`                | Handshake (permite anónimos), rooms, suscripciones                          |
| `lib/realtime/eventos.js`                 | Constantes de eventos y rooms                                               |
| `lib/controllers/categoria_controller.js` | Emite `catalogo_actualizado` tras create/update/destroy                     |
| `lib/controllers/producto_controller.js`  | Idem + stock si combo                                                       |
| `lib/controllers/promocion_controller.js` | Idem                                                                        |

---

## 14. Restricciones

1. **No usar `enabled: enabled && !datosExistentes`** en listas — bloquea refetch tras invalidación.
2. **Siempre `refetchOnReconnect: false`** en hooks con invalidación por socket — `RealtimeBridge` maneja la reconexión.
3. **Invalidar por prefijo (`exact: false`)** para listas con variantes (activas/todas, con/sin productos, etc.).
4. **No crear listeners de socket en componentes de catálogo** — usar `RealtimeBridge`.
5. **Bootstrap siembra solo `public`** — `private` se fetchea bajo demanda tras login.
6. **No enviar datos por socket** — solo identificadores (`{ tipo, id, accion }`). REST es la fuente de verdad.
7. **`staleTime` en ms, no `Infinity`** — permite invalidación manual + refetch en foco de ventana como fallback.

---

## 15. Ver también

- `docs/webSocketContext.md` — arquitectura del canal de tiempo real, eventos, rooms
- `docs/AGENTS.md` — arquitectura y convenciones del backend
- `src/utils/catalogoRealtime.js` — `fusionarPorId`, `quitarPorId` para merge en el lugar
- `docs/perfilContext.md` — otro ejemplo de contexto con caché y sesión
