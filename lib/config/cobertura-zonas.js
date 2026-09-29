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
 * partidos bonaerenses que la rodean. Para esta etapa se incluyen CABA y los
 * partidos del primer y segundo cordón del conurbano (lista editable: los
 * partidos restantes del AMBA pueden agregarse aquí sin tocar el servicio).
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
      'Almirante Brown',
      'Avellaneda',
      'Berazategui',
      'Esteban Echeverría',
      'Ezeiza',
      'Florencio Varela',
      'General San Martín',
      'Hurlingham',
      'Ituzaingó',
      'José C. Paz',
      'La Matanza',
      'Lanús',
      'Lomas de Zamora',
      'Malvinas Argentinas',
      'Merlo',
      'Moreno',
      'Morón',
      'Quilmes',
      'San Fernando',
      'San Isidro',
      'San Miguel',
      'Tigre',
      'Tres de Febrero',
      'Vicente López',
    ],
    localidades: [],
  },
];

module.exports = { ZONAS_COBERTURA: ZONAS };
