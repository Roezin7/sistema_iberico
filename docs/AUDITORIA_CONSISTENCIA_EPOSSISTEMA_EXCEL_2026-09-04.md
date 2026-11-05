# Auditoría de nombres y conexión de catálogo — 2026-09-04

> Registro histórico de septiembre, no estado vigente de producción. Al publicar
> estos cambios el 5 de noviembre se conservan recetas de fechas diferentes:
> la migración sólo puede retirar duplicados del mismo periodo y no inserta
> alias si sus productos aún no existen. Las cifras y pruebas siguientes
> corresponden a la auditoría original, no al catálogo actual.

## Objetivo

Que un producto conserve el mismo significado en Epos, ventas importadas,
recetas, inventario FIFO y el Costeo Maestro. La llave técnica es
`negocio_id + epos_product_id`; el nombre es una etiqueta visible y puede
tener alias históricos.

## Resultado de producción

Se compararon `productos_menu`, `products`, `recetas`, `receta_lineas` y
`epos_ventas` del negocio Ibérico (`negocio_id = 1`).

| Tipo | Resultado |
|---|---|
| Productos de menú activos | 72 |
| Productos de inventario activos | 99 |
| Productos de menú con receta validada | 72 |
| Líneas de receta vigentes | 273 |
| Versiones validadas simultáneas | 0; Montado Ibérico quedó con v2 vigente y v1 retirada |
| Ventas con ProductID | 227 líneas, 61 IDs observados |
| Ventas históricas sin ProductID | 104 líneas; se resuelven por nombre normalizado y alias |

## Diferencias encontradas y corrección

| ID / capa | Antes | Canónico | Acción |
|---|---|---|---|
| Insumo 12 | `Prosseco` | `Prosecco` | Renombrado; alias histórico conservado |
| Insumo 38 | `Pacifico` | `Pacífico` | Renombrado; alias histórico conservado |
| Menú 10 | `Cuba de hacienda de tepa` | `Cuba de Hacienda de Tepa` | Renombrado, mismo ID |
| Menú 125 | `Pizza Madrileña` | `Pizza Madrileña (4 quesos)` | Alineado con el nombre que llega de Epos, mismo ID |
| Menú 146 | `CBA Doble D` | `Cuba de Dobel Diamante` | Renombrado, mismo ID |
| Menú 150 | `Paloma grande dobel` | `Paloma Grande Dobel` | Renombrado, mismo ID |

En ventas históricas se detectaron dos diferencias por ID: `Pacifico` contra
`Pacífico`, y `Pizza Madrileña (4 quesos)` contra `Pizza Madrileña`. Ambas ya
quedan cubiertas por el nombre canónico y el ID; no se reescribió la evidencia
cruda de Epos.

## Recetas y costeo

- Las 72 entradas del menú tienen una receta validada en producción y 273
  líneas enlazadas por `product_id`; las recetas no dependen del texto del
  ingrediente.
- Montado Ibérico tenía dos versiones validadas; se retiró la v1 y se dejó la
  v2 (10 g de manchego) como única receta vigente. La v1 permanece como
  historial.
- El snapshot de bebidas se presenta con los nombres canónicos; los alias
  (`CBA Doble D`, `Cuba de doble diamante`, `Q-C-B-A W-D`, etc.) resuelven
  ventas antiguas sin ProductID.
- El Costeo Maestro se actualizó en una copia fechada, sustituyendo sólo las
  etiquetas inequívocas (`Pizza Madrileña`, `Prosseco`, `Pacifico`). No se
  modificaron precios, fórmulas ni históricos.

## Límites y siguiente conexión

El catálogo remoto de Epos requiere autenticación Basic y el endpoint de
producto V2 está deprecado en favor de V4. El puente de la aplicación sigue
siendo de lectura para el catálogo remoto; por eso los nombres se corrigieron
en la base de Ibérico sin intentar mutar Epos a ciegas. Al ejecutar una
auditoría autenticada de catálogo se debe comparar por ID y aplicar únicamente
los cambios mostrados como diferencia.

La aplicación ya expone `GET /api/epos/catalogo-live` (admin) para hacer esa
comparación directamente contra Epos cuando las variables de producción están
disponibles. El endpoint devuelve `coincide`, `diferente`, `sin_nombre` o
`no_disponible` y no modifica el catálogo remoto.

## Validación

- `npm test`: 113 pruebas aprobadas.
- `npm run build`: cliente y servidor compilados.
- La migración `20260904120000_normalizar_nombres_catalogo` deja las mismas
  correcciones en instalaciones nuevas o restauradas.
