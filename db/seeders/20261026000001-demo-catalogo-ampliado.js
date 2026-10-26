'use strict';

// Complemento del catálogo demo: los 10 ítems que se cargaron desde el panel
// de superadministración y, por lo tanto, no existían en ningún seeder.
//
// Sin este archivo, una base recién migrada quedaba con la carta vieja: faltaban
// la hamburguesa Royale, las pizzas Pepperoni & Miel Picante y Cuatro Quesos,
// los tres postres nuevos, las tres bebidas de cafetería y el Combo Party.
//
// Cada ítem se agrega con el mismo criterio que el resto del catálogo:
//
//  - producto o combo con su imagen, descripción, precio y categoría;
//  - personalización equivalente a la de sus pares de categoría (extras,
//    ingredientes, acompañamientos y condimentos);
//  - stock 150 por sucursal activa; en los combos, derivado de su receta
//    (ver `20261025000003-stock-150.js`);
//  - membresía en las promociones que le corresponden;
//  - pedidos entregados de clientes demo y entre 5 y 9 reseñas por ítem.
//
// Idempotente: busca por NOMBRE (los ids no son portables entre entornos), no
// duplica filas y no pisa datos existentes. `down()` borra solo lo que este
// seeder administra.

const MARCA = 'SEED-CATALOGO';
const CANTIDAD_STOCK = 150;
const DIA = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

// Los nombres son los que quedaron cargados en la base, incluido el punto
// final de "Caramel Frappuccino." y la ausencia de tilde en "Volcan".
const PRODUCTOS = [
  {
    nombre: 'Hamburguesa Royale con Queso & Pepinillos',
    categoria: 'Hamburguesas',
    precio: 11200,
    descripcion: 'Cheddar, pepinillos y sabor americano.',
    imagen:
      '/imagenes/productos/royale-con-queso-pepinillos-1792978170721.webp',
  },
  {
    nombre: 'Pizza Pepperoni & Miel Picante',
    categoria: 'Pizzas',
    precio: 19400,
    descripcion: 'Pepperoni crocante con miel picante.',
    imagen: '/imagenes/productos/pepperoni-miel-picante-1792977811017.webp',
  },
  {
    nombre: 'Pizza Cuatro Quesos',
    categoria: 'Pizzas',
    precio: 20400,
    descripcion: 'Cuatro quesos fundidos en cada porción.',
    imagen: '/imagenes/productos/cuatro-quesos-1792978684687.webp',
  },
  {
    nombre: 'Volcan de Chocolate',
    categoria: 'Postres',
    precio: 8400,
    descripcion: 'Chocolate caliente y una bocha de vainilla.',
    imagen: '/imagenes/productos/volcan-de-chocolate-1792980320227.webp',
  },
  {
    nombre: 'New York Cheesecake con Frutos Rojos',
    categoria: 'Postres',
    precio: 7900,
    descripcion: 'Estilo Nueva York, con frutos rojos frescos.',
    imagen:
      '/imagenes/productos/new-york-cheesecake-con-frutos-rojos-1792980575576.webp',
  },
  {
    nombre: 'Tarta Rogel',
    categoria: 'Postres',
    precio: 7200,
    descripcion: 'Dulce de leche y merengue italiano.',
    imagen: '/imagenes/productos/tarta-rogel-1792980915482.webp',
  },
  {
    nombre: 'Caramel Frappuccino.',
    categoria: 'Bebidas',
    precio: 7500,
    descripcion: 'Café, caramelo y crema batida.',
    imagen: '/imagenes/productos/caramel-frappuccino-1792981142487.jpg',
  },
  {
    nombre: 'Pumpkin Spice Latte',
    categoria: 'Bebidas',
    precio: 7200,
    descripcion: 'Café con especias de calabaza y crema.',
    imagen: '/imagenes/productos/pumpkin-spice-latte-1792981436391.jpg',
  },
  {
    nombre: 'The Pink Drink',
    categoria: 'Bebidas',
    precio: 6900,
    descripcion: 'Frutilla y açaí con leche de coco.',
    imagen: '/imagenes/productos/the-pink-drink-1792981765929.webp',
  },
  {
    nombre: 'Combo Party',
    categoria: 'Combos',
    precio: 72900,
    descripcion:
      'Tres hamburguesas, pizza, dos papas y tres Coca-Cola. Para 5 o 6.',
    imagen: '/imagenes/productos/combo-party-1792979719152.webp',
    tipo: 'COMBO',
  },
];

// Receta del Combo Party (misma que quedó cargada en la base).
const COMPONENTES_COMBO_PARTY = [
  { producto: 'Hamburguesa Cheddar Bacon', cantidad: 1 },
  { producto: 'Hamburguesa Doble', cantidad: 1 },
  { producto: 'Hamburguesa Royale con Queso & Pepinillos', cantidad: 1 },
  { producto: 'Coca-Cola 500ml', cantidad: 3 },
  { producto: 'Pizza Muzzarella', cantidad: 1 },
  { producto: "Papas 'Kimchi' Coreanas", cantidad: 1 },
  { producto: 'Papas Cheddar', cantidad: 1 },
];

// Bases de personalización copiadas de los productos pares ya existentes
// (`20261010000014-personalizacion-uniforme-por-categoria.js`). Los ingredientes
// (`personalizar`) son propios de cada producto y se definen más abajo.
const BASE_HAMBURGUESA = {
  extra: [
    { nombre: 'Bacon', precio: 3200 },
    { nombre: 'Queso Cheddar en fetas', precio: 2400 },
    { nombre: 'Tomate', precio: 1800 },
  ],
  acompanar: [
    {
      nombre: 'Papas Fritas Grandes',
      precio: 6900,
      referencia: 'Papas Fritas Grandes',
    },
  ],
  condimento: ['Sobre de Ketchup', 'Sobre de Mayonesa'],
};

const BASE_PIZZA = {
  extra: [
    { nombre: 'Jamón', precio: 2800 },
    { nombre: 'Muzzarella extra', precio: 2200 },
    { nombre: 'Tomate', precio: 1800 },
  ],
  acompanar: [
    {
      nombre: 'Papas Fritas Grandes',
      precio: 6900,
      referencia: 'Papas Fritas Grandes',
    },
  ],
  condimento: ['Sobre de Ají', 'Sobre de Orégano'],
};

const BASE_POSTRE = {
  extra: [
    { nombre: 'Bocha de helado de crema', precio: 1800 },
    { nombre: 'Chocolate rallado', precio: 1100 },
    { nombre: 'Crema chantilly', precio: 1300 },
    { nombre: 'Dulce de leche', precio: 1200 },
    { nombre: 'Frutillas', precio: 1600 },
  ],
  acompanar: [
    { nombre: 'Coca-Cola 500ml', precio: 3600, referencia: 'Coca-Cola 500ml' },
    {
      nombre: 'Limonada Natural',
      precio: 3400,
      referencia: 'Limonada Natural',
    },
  ],
  condimento: ['Sobre de salsa de chocolate'],
};

const BASE_BEBIDA = {
  acompanar: [
    {
      nombre: 'Hamburguesa Clásica',
      precio: 9800,
      referencia: 'Hamburguesa Clásica',
    },
    {
      nombre: 'Papas Fritas Grandes',
      precio: 6900,
      referencia: 'Papas Fritas Grandes',
    },
  ],
};

const BASE_COMBO = {
  extra: [
    { nombre: 'Bacon', precio: 3200 },
    { nombre: 'Queso Cheddar en fetas', precio: 2400 },
    { nombre: 'Muzzarella extra', precio: 2200 },
    { nombre: 'Cebolla caramelizada', precio: 1400 },
    { nombre: 'Huevo frito', precio: 1500 },
    { nombre: 'Morrón asado', precio: 1800 },
  ],
  personalizar: [
    'Queso Cheddar en fetas',
    'Bacon',
    'Lechuga',
    'Cebolla',
    'Muzzarella',
    'Aceitunas',
  ],
  acompanar: [
    { nombre: 'Papas Cheddar', precio: 8700, referencia: 'Papas Cheddar' },
    {
      nombre: 'Papas Fritas Grandes',
      precio: 6900,
      referencia: 'Papas Fritas Grandes',
    },
    {
      nombre: 'Limonada Natural',
      precio: 3400,
      referencia: 'Limonada Natural',
    },
  ],
  condimento: ['Sobre de Ketchup', 'Sobre de Mostaza'],
};

// Personalización por producto: base de la categoría + ingredientes propios.
const PERSONALIZACION = {
  'Hamburguesa Royale con Queso & Pepinillos': {
    ...BASE_HAMBURGUESA,
    personalizar: [
      'Carne',
      'Cebolla Picada',
      'Pepinillos Encurtidos',
      'Queso Cheddar',
    ],
  },
  'Pizza Pepperoni & Miel Picante': {
    ...BASE_PIZZA,
    personalizar: [
      'Miel Picante',
      'Muzzarella',
      'Pepperoni',
      'Salsa de tomate',
    ],
  },
  'Pizza Cuatro Quesos': {
    ...BASE_PIZZA,
    personalizar: [
      'Muzzarella',
      'Parmesano.',
      'Provolone Rallado',
      'Queso Azul',
    ],
  },
  'Volcan de Chocolate': {
    ...BASE_POSTRE,
    personalizar: ['Chocolate', 'Helado'],
  },
  'New York Cheesecake con Frutos Rojos': {
    ...BASE_POSTRE,
    personalizar: ['Arándanos', 'Frambuesas', 'Frutillas', 'Galletas', 'Queso'],
  },
  'Tarta Rogel': {
    ...BASE_POSTRE,
    personalizar: ['Dulce de Leche', 'Merengue'],
  },
  'Caramel Frappuccino.': {
    ...BASE_BEBIDA,
    personalizar: [
      'Café',
      'Crema Batida (chantilly)',
      'Hielo licuado',
      'Salsa de Caramelo',
    ],
  },
  'Pumpkin Spice Latte': {
    ...BASE_BEBIDA,
    personalizar: ['Café', 'Especias de calabaza', 'Crema batida', 'Leche'],
  },
  'The Pink Drink': {
    ...BASE_BEBIDA,
    personalizar: ['Frutilla', 'Açaí', 'Leche de coco', 'Hielo'],
  },
  'Combo Party': { ...BASE_COMBO },
};

// Comentarios demo por familia, con notas variadas (1 a 5).
const COMENTARIOS = {
  Hamburguesa: [
    { nota: 5, texto: 'Espectacular, llegó caliente y bien armado.' },
    { nota: 5, texto: 'Muy rica y abundante. Repetiría sin dudarlo.' },
    { nota: 5, texto: 'El pan estaba perfecto y la carne jugosa.' },
    { nota: 4, texto: 'Muy bueno, aunque me hubiese gustado más salsa.' },
    { nota: 4, texto: 'Buen sabor y buena porción. Llegó a tiempo.' },
    { nota: 3, texto: 'Rico, pero esperaba un poco más por el precio.' },
  ],
  Pizza: [
    { nota: 5, texto: 'De las mejores que pedí: masa fina y bien cocida.' },
    { nota: 5, texto: 'Mucho queso y bien caliente. Ideal para compartir.' },
    { nota: 4, texto: 'Muy sabrosa; la porción podría ser más grande.' },
    { nota: 4, texto: 'Buen equilibrio de sabores y llegó en buen estado.' },
    { nota: 5, texto: 'Excelente relación precio-calidad.' },
    { nota: 3, texto: 'Estaba rica, aunque un poco aceitosa para mi gusto.' },
  ],
  Postre: [
    { nota: 5, texto: 'Llegó impecable y súper fresco.' },
    { nota: 5, texto: 'Dulce en su punto justo, no empalaga.' },
    { nota: 4, texto: 'Muy rico; me hubiese gustado un poco más de porción.' },
    { nota: 5, texto: 'Textura perfecta y sabor casero.' },
    { nota: 4, texto: 'Buen postre, llegó bien frío.' },
    { nota: 3, texto: 'Estaba rico, pero bastante dulce para mi gusto.' },
  ],
  Bebida: [
    { nota: 5, texto: 'Llegó bien fría y en el vaso justo.' },
    { nota: 5, texto: 'Muy rica, con el hielo perfecto.' },
    { nota: 4, texto: 'Buen sabor; podría venir un poco más grande.' },
    { nota: 4, texto: 'Refrescante y bien preparada.' },
    { nota: 5, texto: 'Ideal para acompañar la comida.' },
    { nota: 3, texto: 'Estaba rica, aunque se le sentía mucho el azúcar.' },
  ],
  Combo: [
    {
      nota: 5,
      texto: 'Rinde un montón y llegó todo caliente. Para compartir.',
    },
    {
      nota: 5,
      texto: 'Muy completo: hamburguesas, pizza y papas en un pedido.',
    },
    { nota: 4, texto: 'Excelente para grupo; alcanzó justo para todos.' },
    { nota: 5, texto: 'Buena variedad y todo bien embalado.' },
    { nota: 4, texto: 'Muy bueno, aunque tardó un poco más de lo estimado.' },
    { nota: 3, texto: 'Rico y abundante, pero algunas cosas llegaron tibias.' },
  ],
};

const FAMILIA_POR_CATEGORIA = {
  Hamburguesas: 'Hamburguesa',
  Pizzas: 'Pizza',
  Postres: 'Postre',
  Bebidas: 'Bebida',
  Combos: 'Combo',
};

// Direcciones de los pedidos demo (CABA).
const DIRECCIONES = [
  {
    calle: 'Av. Rivadavia',
    altura: 5420,
    ciudad: 'CABA',
    codigoPostal: '1424',
    referencia: 'Timbre 2B',
    latitud: -34.6215,
    longitud: -58.437,
  },
  {
    calle: 'Av. Santa Fe',
    altura: 3255,
    ciudad: 'CABA',
    codigoPostal: '1425',
    referencia: 'Portón negro',
    latitud: -34.5888,
    longitud: -58.4136,
  },
  {
    calle: 'Av. Corrientes',
    altura: 4800,
    ciudad: 'CABA',
    codigoPostal: '1414',
    referencia: 'Piso 4, departamento A',
    latitud: -34.6035,
    longitud: -58.434,
  },
  {
    calle: 'Av. Cabildo',
    altura: 2100,
    ciudad: 'CABA',
    codigoPostal: '1428',
    referencia: 'Casa con rejas',
    latitud: -34.5631,
    longitud: -58.4569,
  },
];

// Etapas de un pedido entregado (mismas que usa el seeder de clientes demo).
const ESTADOS_ENTREGADO = [
  { nombre: 'pendiente', minutos: 0 },
  { nombre: 'confirmado', minutos: 2 },
  { nombre: 'en_preparacion', minutos: 5 },
  { nombre: 'listo_para_entregar', minutos: 20 },
  { nombre: 'en_camino', minutos: 30 },
  { nombre: 'entregado', minutos: 50 },
];

async function obtenerFilas(queryInterface, sql, replacements) {
  const [filas] = await queryInterface.sequelize.query(
    sql,
    replacements ? { replacements } : undefined
  );
  return filas;
}

const familiaDe = (categoria) => FAMILIA_POR_CATEGORIA[categoria] || 'Combo';

// Productos: inserta solo los que faltan y devuelve el mapa nombre -> fila.
async function asegurarProductos(queryInterface, idCategoria) {
  const filas = await obtenerFilas(
    queryInterface,
    'SELECT id, nombre, tipo, "categoriaId", precio, imagen FROM "Productos"'
  );
  const porNombre = new Map(filas.map((fila) => [fila.nombre, fila]));
  let creados = 0;

  for (const definicion of PRODUCTOS) {
    const categoriaId = idCategoria.get(definicion.categoria);
    if (!categoriaId) {
      throw new Error(
        `Catálogo ampliado: falta la categoría "${definicion.categoria}". Ejecutar 20260912000001.`
      );
    }
    if (porNombre.has(definicion.nombre)) continue;

    const [insertadas] = await queryInterface.sequelize.query(
      `INSERT INTO "Productos"
         ("nombre","descripcion","precio","imagen","tipo","categoriaId",
          "activo","createdAt","updatedAt")
       VALUES
         (:nombre,:descripcion,:precio,:imagen,:tipo,:categoriaId,
          TRUE,NOW(),NOW())
       RETURNING id, nombre, tipo, "categoriaId", precio, imagen`,
      {
        replacements: {
          nombre: definicion.nombre,
          descripcion: definicion.descripcion,
          precio: definicion.precio,
          imagen: definicion.imagen,
          tipo: definicion.tipo || 'PRODUCTO',
          categoriaId,
        },
      }
    );
    porNombre.set(definicion.nombre, insertadas[0]);
    creados += 1;
  }

  return { porNombre, creados };
}

// Receta del Combo Party: upsert por (comboId, productoId).
async function asegurarComponentes(queryInterface, porNombre) {
  const combo = porNombre.get('Combo Party');
  if (!combo) return 0;

  let escritos = 0;
  for (const componente of COMPONENTES_COMBO_PARTY) {
    const producto = porNombre.get(componente.producto);
    if (!producto) {
      console.warn(
        `Catálogo ampliado: falta el componente "${componente.producto}" del Combo Party.`
      );
      continue;
    }
    await queryInterface.sequelize.query(
      `INSERT INTO "ComboComponentes"
         ("comboId","productoId","cantidad","createdAt","updatedAt")
       VALUES (:comboId,:productoId,:cantidad,NOW(),NOW())
       ON CONFLICT ("comboId","productoId") DO UPDATE SET
         "cantidad" = EXCLUDED."cantidad",
         "updatedAt" = NOW()`,
      {
        replacements: {
          comboId: combo.id,
          productoId: producto.id,
          cantidad: componente.cantidad,
        },
      }
    );
    escritos += 1;
  }
  return escritos;
}

// Personalización: inserta solo las combinaciones que faltan.
async function asegurarPersonalizacion(queryInterface, porNombre) {
  const existentes = await obtenerFilas(
    queryInterface,
    'SELECT "productoId", tipo, nombre, "productoReferenciaId" FROM "PersonalizacionElementos"'
  );
  const claves = new Set(
    existentes.map(
      (fila) =>
        `${fila.productoId}|${fila.tipo}|${fila.nombre}|${
          fila.productoReferenciaId ?? ''
        }`
    )
  );

  const ahora = new Date();
  const aInsertar = [];

  for (const definicion of PRODUCTOS) {
    const producto = porNombre.get(definicion.nombre);
    const configuracion = PERSONALIZACION[definicion.nombre];
    if (!producto || !configuracion) continue;

    const agregar = (tipo, elemento) => {
      const referencia = elemento.referencia
        ? porNombre.get(elemento.referencia)
        : null;
      if (elemento.referencia && !referencia) {
        console.warn(
          `Catálogo ampliado: "${definicion.nombre}" omite el acompañamiento "${elemento.referencia}" porque no existe.`
        );
        return;
      }
      const fila = {
        productoId: producto.id,
        tipo,
        nombre: elemento.nombre || elemento,
        precio:
          tipo === 'extra' || tipo === 'acompanar' ? elemento.precio : null,
        productoReferenciaId: referencia ? referencia.id : null,
        minimo: 0,
        maximo: 1,
        activo: true,
        createdAt: ahora,
        updatedAt: ahora,
      };
      const clave = `${fila.productoId}|${fila.tipo}|${fila.nombre}|${
        fila.productoReferenciaId ?? ''
      }`;
      if (claves.has(clave)) return;
      claves.add(clave);
      aInsertar.push(fila);
    };

    (configuracion.extra || []).forEach((elemento) =>
      agregar('extra', elemento)
    );
    (configuracion.personalizar || []).forEach((elemento) =>
      agregar('personalizar', elemento)
    );
    (configuracion.acompanar || []).forEach((elemento) =>
      agregar('acompanar', elemento)
    );
    (configuracion.condimento || []).forEach((elemento) =>
      agregar('condimento', elemento)
    );
  }

  if (aInsertar.length) {
    await queryInterface.bulkInsert('PersonalizacionElementos', aInsertar);
  }
  return aInsertar.length;
}

// Stock: 150 por sucursal activa; los combos, según su receta.
async function asegurarStock(queryInterface, porNombre) {
  const sucursales = await obtenerFilas(
    queryInterface,
    'SELECT id FROM "Sucursales" WHERE activa = TRUE ORDER BY id'
  );
  if (!sucursales.length) {
    throw new Error(
      'Catálogo ampliado: no hay sucursales activas. Ejecutar 20260915000001.'
    );
  }

  const componentes = await obtenerFilas(
    queryInterface,
    'SELECT "comboId","productoId","cantidad" FROM "ComboComponentes"'
  );
  const recetas = new Map();
  componentes.forEach((componente) => {
    if (!recetas.has(componente.comboId)) recetas.set(componente.comboId, []);
    recetas.get(componente.comboId).push(componente);
  });

  let pares = 0;
  for (const definicion of PRODUCTOS) {
    const producto = porNombre.get(definicion.nombre);
    if (!producto) continue;

    let cantidad = CANTIDAD_STOCK;
    if (producto.tipo === 'COMBO') {
      const receta = recetas.get(producto.id) || [];
      cantidad = receta.length
        ? receta.reduce(
            (minimo, componente) =>
              Math.min(
                minimo,
                Math.floor(
                  CANTIDAD_STOCK / Math.max(1, Number(componente.cantidad))
                )
              ),
            Infinity
          )
        : 0;
      if (cantidad === Infinity) cantidad = 0;
    }

    for (const sucursal of sucursales) {
      await queryInterface.sequelize.query(
        `INSERT INTO "Stocks"
           ("sucursalId","productoId","cantidad","disponible","createdAt","updatedAt")
         VALUES (:sucursalId,:productoId,:cantidad,TRUE,NOW(),NOW())
         ON CONFLICT ("sucursalId","productoId") DO UPDATE SET
           "cantidad" = EXCLUDED."cantidad",
           "disponible" = TRUE,
           "updatedAt" = NOW()`,
        {
          replacements: {
            sucursalId: sucursal.id,
            productoId: producto.id,
            cantidad,
          },
        }
      );
      pares += 1;
    }
  }
  return pares;
}

// La promo de postres se creó desde el panel y no vive en ningún seeder. Si
// falta, se crea para que los postres nuevos tengan su descuento.
async function asegurarPromoPostres(queryInterface) {
  const filas = await obtenerFilas(
    queryInterface,
    `SELECT id FROM "Promociones"
      WHERE regexp_replace(nombre, '\\s+', ' ', 'g') = 'Promo 30% Postres'
      ORDER BY id
      LIMIT 1`
  );
  if (filas.length) return filas[0].id;

  const ahora = new Date();
  const [creadas] = await queryInterface.sequelize.query(
    `INSERT INTO "Promociones"
       ("nombre","descripcion","tipo","valor","fechaInicio","fechaFin",
        "activa","createdAt","updatedAt")
     VALUES
       (:nombre,:descripcion,'DESCUENTO_PORCENTUAL',30,:inicio,:fin,
        TRUE,NOW(),NOW())
     RETURNING id`,
    {
      replacements: {
        nombre: 'Promo 30%  Postres',
        descripcion: 'Endulza tu día con un 30% de descuento.',
        inicio: ahora,
        fin: new Date(ahora.getTime() + 365 * DIA),
      },
    }
  );
  return creadas[0].id;
}

// Membresías de promo: Royale en 10% hamburguesas y los postres en 30%.
async function asegurarPromociones(queryInterface, porNombre) {
  const hamburguesas = await obtenerFilas(
    queryInterface,
    'SELECT id FROM "Promociones" WHERE nombre = :nombre ORDER BY id LIMIT 1',
    { nombre: 'Promo 10% Hamburguesas' }
  );
  if (!hamburguesas.length) {
    console.warn(
      'Catálogo ampliado: no existe "Promo 10% Hamburguesas"; la Royale queda sin promo.'
    );
  }

  const promoPostresId = await asegurarPromoPostres(queryInterface);
  const objetivos = [];

  if (hamburguesas.length) {
    objetivos.push({
      promocionId: hamburguesas[0].id,
      productos: ['Hamburguesa Royale con Queso & Pepinillos'],
    });
  }
  objetivos.push({
    promocionId: promoPostresId,
    productos: [
      'Volcan de Chocolate',
      'New York Cheesecake con Frutos Rojos',
      'Tarta Rogel',
      'Lava Cake',
      'Cheesecake',
      'Hamburguesa Dulce',
    ],
  });

  const vinculosExistentes = await obtenerFilas(
    queryInterface,
    'SELECT "promocionId","productoId" FROM "PromocionProductos" WHERE "promocionId" IN (:ids)',
    { ids: objetivos.map((objetivo) => objetivo.promocionId) }
  );
  const claves = new Set(
    vinculosExistentes.map(
      (vinculo) => `${vinculo.promocionId}|${vinculo.productoId}`
    )
  );

  const ahora = new Date();
  const aInsertar = [];
  for (const objetivo of objetivos) {
    for (const nombre of objetivo.productos) {
      const producto = porNombre.get(nombre);
      if (!producto) {
        console.warn(
          `Catálogo ampliado: no se pudo vincular "${nombre}" a la promo porque no existe.`
        );
        continue;
      }
      const clave = `${objetivo.promocionId}|${producto.id}`;
      if (claves.has(clave)) continue;
      claves.add(clave);
      aInsertar.push({
        promocionId: objetivo.promocionId,
        productoId: producto.id,
        createdAt: ahora,
        updatedAt: ahora,
      });
    }
  }

  if (aInsertar.length) {
    await queryInterface.bulkInsert('PromocionProductos', aInsertar);
  }
  return aInsertar.length;
}

// Pedidos entregados de clientes demo + reseñas para los ítems nuevos.
//
// Solo crea lo que falta: si un producto ya tiene sus reseñas (por ejemplo,
// porque corrió `20261025000002-demo-clientes-compras.js` después de que los
// productos existieran), no toca nada.
async function asegurarResenas(queryInterface, porNombre) {
  const estados = await obtenerFilas(
    queryInterface,
    'SELECT id, nombre FROM "EstadoPedidos"'
  );
  const idEstado = new Map(estados.map((estado) => [estado.nombre, estado.id]));
  const entregado = idEstado.get('entregado');
  if (!entregado) {
    throw new Error(
      'Catálogo ampliado: falta el estado "entregado". Ejecutar 20260915000001.'
    );
  }

  const clientes = await obtenerFilas(
    queryInterface,
    `SELECT id FROM "Usuarios"
      WHERE email LIKE '%@demo.com' AND rol = 'CLIENTE' AND activo = TRUE
      ORDER BY id`
  );
  if (!clientes.length) {
    console.warn(
      'Catálogo ampliado: no hay clientes demo; se omiten pedidos y reseñas.'
    );
    return 0;
  }

  const sucursales = await obtenerFilas(
    queryInterface,
    'SELECT id FROM "Sucursales" WHERE activa = TRUE ORDER BY id'
  );
  if (!sucursales.length) {
    throw new Error(
      'Catálogo ampliado: no hay sucursales activas para los pedidos demo.'
    );
  }

  const nuevos = PRODUCTOS.map((definicion) => {
    const fila = porNombre.get(definicion.nombre);
    return fila
      ? {
          id: fila.id,
          nombre: fila.nombre,
          precio: Number(fila.precio),
          familia: familiaDe(definicion.categoria),
        }
      : null;
  }).filter(Boolean);

  const ids = nuevos.map((producto) => producto.id);
  const resenadas = await obtenerFilas(
    queryInterface,
    'SELECT "usuarioId","productoId" FROM "Resenas" WHERE "productoId" IN (:ids)',
    { ids }
  );
  const yaResenadas = new Set(
    resenadas.map((fila) => `${fila.usuarioId}|${fila.productoId}`)
  );

  // Origen ya elegible: un pedido entregado que contiene el producto.
  const elegibles = await obtenerFilas(
    queryInterface,
    `SELECT DISTINCT ON (p."usuarioId", i."productoId")
            p."usuarioId", i."productoId", p.id AS "pedidoId", p."fechaHora"
       FROM "Pedidos" p
       JOIN "PedidoItems" i ON i."pedidoId" = p.id
      WHERE p."estadoId" = :entregado
        AND i."productoId" IN (:ids)
      ORDER BY p."usuarioId", i."productoId", p."fechaHora" DESC`,
    { entregado, ids }
  );
  const origen = new Map(
    elegibles.map((fila) => [`${fila.usuarioId}|${fila.productoId}`, fila])
  );

  // 5 a 9 clientes distintos por producto, rotando el punto de partida para
  // que no sean siempre los mismos personajes.
  const pendientes = [];
  nuevos.forEach((producto, indice) => {
    const objetivo = Math.min(5 + (indice % 5), clientes.length);
    let cubiertos = 0;
    for (
      let paso = 0;
      paso < clientes.length && cubiertos < objetivo;
      paso += 1
    ) {
      const cliente = clientes[(indice * 5 + paso * 7) % clientes.length];
      const clave = `${cliente.id}|${producto.id}`;
      cubiertos += 1;
      if (yaResenadas.has(clave)) continue;
      yaResenadas.add(clave);
      pendientes.push({ ...producto, clienteId: cliente.id });
    }
  });

  // Los pares que ya tienen un pedido entregado se reseñan sobre ese pedido.
  // Los demás se agrupan por cliente para crear un solo pedido por cliente.
  const resenas = [];
  const aCrear = new Map();
  pendientes.forEach((pendiente) => {
    const clave = `${pendiente.clienteId}|${pendiente.id}`;
    const fila = origen.get(clave);
    if (fila) {
      resenas.push({
        ...pendiente,
        pedidoId: fila.pedidoId,
        fechaHora: new Date(fila.fechaHora),
      });
      return;
    }
    if (!aCrear.has(pendiente.clienteId)) aCrear.set(pendiente.clienteId, []);
    aCrear.get(pendiente.clienteId).push(pendiente);
  });

  const ahora = Date.now();
  let numero = 0;
  for (const [clienteId, items] of aCrear) {
    const fechaHora = new Date(
      ahora - ((numero % 9) + 1) * DIA - (90 + (numero % 240)) * MIN
    );
    const sucursalId = sucursales[numero % sucursales.length].id;
    const direccion = DIRECCIONES[numero % DIRECCIONES.length];
    const total = items.reduce((suma, item) => suma + item.precio, 0);

    const [creados] = await queryInterface.sequelize.query(
      `INSERT INTO "Pedidos"
         ("usuarioId","sucursalId","fechaHora","estadoId","costoEnvio","total",
          "medioPago","observacion","calle","altura","ciudad","codigoPostal",
          "referencia","latitud","longitud","etaMinutos","etaCalculadoEn",
          "horaEstimadaLlegada","createdAt","updatedAt")
       VALUES
         (:usuarioId,:sucursalId,:fechaHora,:estadoId,0,:total,
          :medioPago,:observacion,:calle,:altura,:ciudad,:codigoPostal,
          :referencia,:latitud,:longitud,NULL,NULL,NULL,:fechaHora,:fechaHora)
       RETURNING id`,
      {
        replacements: {
          usuarioId: clienteId,
          sucursalId,
          fechaHora,
          estadoId: entregado,
          total,
          medioPago: numero % 2 === 0 ? 'MERCADO_PAGO' : 'TARJETA',
          observacion: MARCA,
          calle: direccion.calle,
          altura: direccion.altura,
          ciudad: direccion.ciudad,
          codigoPostal: direccion.codigoPostal,
          referencia: direccion.referencia,
          latitud: direccion.latitud,
          longitud: direccion.longitud,
        },
      }
    );
    const pedidoId = creados[0].id;

    await queryInterface.bulkInsert(
      'PedidoItems',
      items.map((item) => ({
        pedidoId,
        productoId: item.id,
        nombreProducto: item.nombre,
        precioUnitario: item.precio,
        cantidad: 1,
        subtotal: item.precio,
        observacion: null,
        createdAt: fechaHora,
        updatedAt: fechaHora,
      }))
    );

    await queryInterface.bulkInsert(
      'PedidoEstadoHistorials',
      ESTADOS_ENTREGADO.map((paso) => ({
        pedidoId,
        estadoId: idEstado.get(paso.nombre),
        usuarioId: clienteId,
        fechaHora: new Date(fechaHora.getTime() + paso.minutos * MIN),
        observacion: MARCA,
        createdAt: fechaHora,
        updatedAt: fechaHora,
      }))
    );

    items.forEach((item) => {
      resenas.push({ ...item, pedidoId, fechaHora });
    });
    numero += 1;
  }

  const filas = resenas.map((resena, indice) => {
    const bolsa = COMENTARIOS[resena.familia] || COMENTARIOS.Combo;
    const comentario = bolsa[(resena.id + indice) % bolsa.length];
    const creadaEn = new Date(
      Math.min(
        Date.now() - MIN,
        resena.fechaHora.getTime() + (90 + (indice % 5) * 35) * MIN
      )
    );
    return {
      usuarioId: resena.clienteId,
      productoId: resena.id,
      pedidoId: resena.pedidoId,
      puntuacion: comentario.nota,
      comentario: comentario.texto,
      createdAt: creadaEn,
      updatedAt: creadaEn,
    };
  });

  if (filas.length) {
    await queryInterface.bulkInsert('Resenas', filas);
  }
  return filas.length;
}

module.exports = {
  up: async (queryInterface) => {
    const categorias = await obtenerFilas(
      queryInterface,
      'SELECT id, nombre FROM "Categorias"'
    );
    const idCategoria = new Map(
      categorias.map((categoria) => [categoria.nombre, categoria.id])
    );

    const { porNombre, creados } = await asegurarProductos(
      queryInterface,
      idCategoria
    );
    const componentes = await asegurarComponentes(queryInterface, porNombre);
    const elementos = await asegurarPersonalizacion(queryInterface, porNombre);
    const paresStock = await asegurarStock(queryInterface, porNombre);
    const vinculos = await asegurarPromociones(queryInterface, porNombre);
    const resenas = await asegurarResenas(queryInterface, porNombre);

    console.log(
      `Catálogo ampliado: ${creados} productos nuevos, ${componentes} componentes de combo, ` +
        `${elementos} elementos de personalización, ${paresStock} pares de stock, ` +
        `${vinculos} vínculos de promo y ${resenas} reseñas.`
    );
  },

  down: async (queryInterface) => {
    const nombres = PRODUCTOS.map((producto) => producto.nombre);
    const productos = await obtenerFilas(
      queryInterface,
      'SELECT id FROM "Productos" WHERE nombre IN (:nombres)',
      { nombres }
    );
    const ids = productos.map((producto) => producto.id);
    if (!ids.length) {
      console.log('Catálogo ampliado: no había nada para revertir.');
      return;
    }

    // Las reseñas apuntan al producto con RESTRICT: hay que borrarlas antes.
    await queryInterface.sequelize.query(
      'DELETE FROM "Resenas" WHERE "productoId" IN (:ids)',
      { replacements: { ids } }
    );

    await queryInterface.sequelize.query(
      `DELETE FROM "PedidoEstadoHistorials"
        WHERE "pedidoId" IN (SELECT id FROM "Pedidos" WHERE observacion = :marca)`,
      { replacements: { marca: MARCA } }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "PedidoItems"
        WHERE "pedidoId" IN (SELECT id FROM "Pedidos" WHERE observacion = :marca)`,
      { replacements: { marca: MARCA } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "Pedidos" WHERE observacion = :marca',
      { replacements: { marca: MARCA } }
    );

    await queryInterface.sequelize.query(
      'DELETE FROM "PromocionProductos" WHERE "productoId" IN (:ids)',
      { replacements: { ids } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "PersonalizacionElementos" WHERE "productoId" IN (:ids)',
      { replacements: { ids } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "Stocks" WHERE "productoId" IN (:ids)',
      { replacements: { ids } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "ComboComponentes" WHERE "comboId" IN (:ids)',
      { replacements: { ids } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "Productos" WHERE id IN (:ids)',
      { replacements: { ids } }
    );

    console.log(
      `Catálogo ampliado revertido: ${ids.length} productos, sus reseñas, personalización, stock y pedidos demo.`
    );
  },
};
