/**
 * Configuración de zonas geográficas de operación (cobertura de delivery).
 *
 * Estructura de datos, no lógica: el servicio de cobertura (`cobertura_service`)
 * evalúa las zonas contra los datos territoriales normalizados que devuelve
 * Georef Argentina (`normalizada.provincia`, `normalizada.departamento`,
 * `normalizada.localidad`). Agregar o quitar zonas/partidos NO requiere
 * modificar la lógica del servicio: solo editar esta lista.
 *
 * Formato de cada zona:
 *   - nombre:      identificador de la zona (se devuelve en la respuesta).
 *   - provincias:  provincias habilitadas (obligatorio al menos una).
 *   - departamentos: partidos/departimentos habilitados. Lista vacía = no se
 *     filtra por departamento (toda la provincia).
 *   - localidades: localidades censales habilitadas. Lista vacía = no se filtra
 *     por localidad.
 *
 * La comparación es insensible a mayúsculas/minúsculas y acentos.
 *
 * Definición adoptada de AMBA (documentada explícitamente): el proyecto no
 * define la zona de operación en su documentación funcional, por lo que se
 * adopta la definición oficial del AMBA / Región Metropolitana de Buenos Aires
 * (INDEC): la Ciudad Autónoma de Buenos Aires más la totalidad de los 40
 * partidos bonaerenses que la rodean.
 *
 * Iteración 4: la zona AMBA pasa a contemplar los 40 partidos COMPLETOS de
 * esa definición (antes solo el primer y segundo cordón del conurbano; los
 * 16 partidos restantes ya estaban identificados en la documentación). Los
 * nombres fueron verificados contra los departamentos de Georef de la
 * provincia de Buenos Aires (la comparación es insensible a
 * mayúsculas/acentos). Importante: pertenecer a la zona HABILITA el intento,
 * pero NO garantiza el alta: sigue siendo obligatorio que exista una
 * sucursal activa a ≤ COBERTURA_RADIO_MAX_KM por ruta (regla sin cambios en
 * cobertura_service). Los partidos de la provincia fuera del AMBA (p. ej.
 * Bahía Blanca, General Pueyrredón) siguen fuera de la zona: NO se habilita
 * la provincia completa por eso.
 */

const ZONAS = [
  {
    nombre: 'CABA',
    provincias: ['Ciudad Autónoma de Buenos Aires'],
    departamentos: [],
    localidades: [],
  },
  {
    nombre: 'AMBA',
    provincias: ['Buenos Aires'],
    departamentos: [
      // 40 partidos del AMBA (definición INDEC), en orden alfabético.
      'Almirante Brown',
      'Avellaneda',
      'Berazategui',
      'Berisso',
      'Brandsen',
      'Campana',
      'Cañuelas',
      'Ensenada',
      'Escobar',
      'Esteban Echeverría',
      'Exaltación de la Cruz',
      'Ezeiza',
      'Florencio Varela',
      'General Las Heras',
      'General Rodríguez',
      'General San Martín',
      'Hurlingham',
      'Ituzaingó',
      'José C. Paz',
      'La Matanza',
      'La Plata',
      'Lanús',
      'Lomas de Zamora',
      'Luján',
      'Malvinas Argentinas',
      'Marcos Paz',
      'Merlo',
      'Moreno',
      'Morón',
      'Pilar',
      'Presidente Perón',
      'Quilmes',
      'San Fernando',
      'San Isidro',
      'San Miguel',
      'San Vicente',
      'Tigre',
      'Tres de Febrero',
      'Vicente López',
      'Zárate',
    ],
    localidades: [],
  },
];

module.exports = { ZONAS_COBERTURA: ZONAS };
