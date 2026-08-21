# Reconciliación de tickets y FIFO — semana 63

Fecha de revisión: 21 de agosto de 2026  
Periodo: 10–16 de agosto de 2026  
Negocio: Ibérico

## Conclusión

Los tickets de compras de la semana 63 ya habían sido proporcionados y sí
quedaron registrados en producción como movimientos financieros. No se deben
volver a cargar ni volver a contabilizar como gasto.

La discrepancia está en otra capa: la base actual no conserva esos cuatro
tickets como registros detallados de `purchases` y `purchase_lines`, por lo que
sus líneas tampoco generaron lotes FIFO asociados a la compra. El documento
anterior que afirmaba que había 24 lotes de compras y 55 presentaciones no es
reproducible contra la base actual y debe tratarse como estado de una ejecución
anterior, no como evidencia vigente.

## Compras financieras ya existentes

| Movimiento | Fecha | Proveedor / referencia | Importe | Tratamiento |
|---:|---|---|---:|---|
| 1100 | 2026-08-11 | Bodegas Alameda | $2,922.00 | Ya contabilizado; no duplicar |
| 1101 | 2026-08-11 | Costco — inventario | $2,697.56 | Ya contabilizado; no duplicar |
| 1123 | 2026-08-11 | Costco — no inventariable | $622.44 | Gasto ya contabilizado; no duplicar |
| 1102 | 2026-08-11 | La Comer 1 | $1,546.50 | Ya contabilizado; no duplicar |
| 1103 | 2026-08-11 | La Comer 2 | $137.20 | Ya contabilizado; no duplicar |
| **Total** |  |  | **$7,925.70** |  |

El ticket de Costco conserva el total de $3,320.00 como la suma de inventario
($2,697.56) y gasto no inventariable ($622.44). La fotografía de Heinz por
$32.10 es una línea del ticket de La Comer, no un ticket adicional.

## Estado que sí existe en la base

- Semana 63: cerrada.
- Semana 64: abierta.
- Ventas Epos de la semana 63: 104 filas importadas.
- Costeo histórico actual: 55 ventas costeadas y 33 excepciones.
- Consumos históricos existentes: 219 líneas.
- Lotes de apertura histórica: aislados con fuente `historico_prueba`.
- Ajustes históricos: aislados con referencia `AJUSTE-FALTANTES-63`.
- Lotes normales de la semana 64: 79 lotes, 423 unidades agregadas, sin cambio
  después de la prueba.
- Compras detalladas actuales en producción: únicamente tickets del 20 de
  agosto (semana 64); no corresponden a la semana 63.

## Implicación para el piloto

El resultado de la semana 63 no debe presentarse todavía como margen FIFO real
por compra. El costo actual utiliza la apertura y los ajustes históricos, pero
no los precios por lote de los tickets del 11 de agosto.

La siguiente operación correcta es una **reconstrucción histórica idempotente**:

1. Crear el detalle de los cuatro tickets usando la información ya documentada.
2. Asociarlo a los movimientos financieros existentes, sin crear movimientos
   nuevos.
3. Crear lotes con fuente `historico_prueba` y fecha 2026-08-11.
4. Revertir únicamente los consumos históricos de la prueba y los ajustes que
   sean sustituidos por compras reales.
5. Recalcular el costeo de la semana 63.
6. Mantener excluida la semana 64.

No debe ejecutarse esa reconstrucción hasta que cada línea tenga presentación,
unidad base y costo verificables. Una línea sin esa información debe quedar como
excepción, no convertirse en un número inventado.

## Regla de no duplicación

- Los movimientos 1100, 1101, 1123, 1102 y 1103 son la fuente financiera ya
  existente.
- Los tickets históricos deberán usar referencias idempotentes propias y
  enlazarse a esos movimientos.
- Los tickets actuales del 20 de agosto no se mueven a la semana 63.
- La semana activa 64 no se modifica durante esta reconstrucción.
