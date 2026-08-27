# Auditoría de unidades y valuación de inventario

**Fecha:** 27 de agosto de 2026  
**Alcance:** catálogo activo, unidades de captura, mínimos y valuación actual de producción.

## Resultado ejecutivo

El catálogo activo quedó normalizado a tres unidades base: `g`, `ml` y `pieza`. Las presentaciones comerciales (botella, bolsa, paquete, caja, lata, manojo, etc.) permanecen como unidades de captura y se convierten mediante su factor, sin mezclarlas con la unidad base.

La valuación vigente del inventario usa los lotes FIFO abiertos. El costo de catálogo se conserva como referencia para identificar diferencias de precio o cantidades todavía no explicadas por un lote.

## Auditoría realizada

| Control | Resultado |
| --- | ---: |
| Productos activos revisados | 97 |
| Unidad base `ml` | 39 |
| Unidad base `g` | 31 |
| Unidad base `pieza` | 27 |
| Configuraciones de zona/unidad revisadas | 164 |
| Factores inválidos o menores/iguales a cero | 0 |
| Mínimos ausentes o menores/iguales a cero | 0 |
| Productos sin costo para valuación | 0 |

Los factores revisados son coherentes con su presentación: por ejemplo, `kg → g`, `l → ml`, botella → contenido en ml, paquete/caja → contenido en g o piezas, y cerveza → pieza.

## Correcciones aplicadas

Se normalizaron 16 productos cuya unidad base estaba vacía o expresada como presentación. La corrección fue semántica y no cambió cantidades económicas históricas:

- productos discretos sin unidad → `pieza`;
- `rollo`, `paquete` y `bolsa` usados como unidad base → `pieza`;
- se conservaron `unidad_compra` y `contenido_compra` para la conversión.

También se corrigieron dos lotes de apertura que habían sido registrados con el precio de la presentación como si fuera el precio de cada unidad:

- Papel de baño: 3 → 9 rollos y costo unitario 519 → 173;
- Toalla interdoblada: 16 → 128 paquetes y costo unitario 199 → 24.875.

El valor total de cada lote se conservó; sólo se corrigió la unidad económica.

## Valuación actual de producción

El conteo vigente es el snapshot **59**, tipo **cierre**, asociado a la semana **64**.

| Valuación | Importe |
| --- | ---: |
| FIFO activo (operativa) | **$38,180.65** |
| Catálogo (referencia) | **$38,071.78** |
| Diferencia FIFO − catálogo | **$108.87** |

La interfaz de **Existencia actual** muestra ahora las tres cifras y, por producto, la fuente de valuación (`FIFO`, `mixta`, `catálogo` o `sin costo`) junto con la existencia y el mínimo en unidades operativas. Los gramos y mililitros quedan ocultos al operador: sólo se usan internamente para recetas, FIFO y costeo.

## Diferencias que siguen abiertas

Hay productos cuyo conteo físico excede el saldo de lotes abiertos. El sistema los marca como valuación **mixta** y valora el excedente al costo de catálogo; no se crea inventario ficticio automáticamente. Esto no es una falla de unidad por sí mismo: requiere confirmar si corresponde a una compra no capturada, una apertura incompleta, producción interna, ajuste o posible merma invertida.

Los mayores saldos físicos no explicados por lotes son Harina, Squirt, Papas a la francesa, Jamón Serrano, Ketchup y Pepino. Deben resolverse contra tickets y el inventario de apertura antes de usar la diferencia como merma.

## Regla operativa permanente

1. Capturar la cantidad en la presentación que realmente se cuenta.
2. Convertir siempre a la unidad base mediante el factor guardado.
3. Comparar mínimos internamente en unidad base, pero mostrarlos al operador en unidades físicas.
4. Valorar existencias con FIFO activo; usar catálogo sólo para el excedente identificado.
5. No corregir un faltante de lote creando existencias: primero clasificarlo como compra faltante, apertura, ajuste, receta, captura o posible merma.

La auditoría se puede repetir con `server/scripts/auditar-unidades-corregir.ts`; el script es idempotente y ofrece `--dry-run`.
