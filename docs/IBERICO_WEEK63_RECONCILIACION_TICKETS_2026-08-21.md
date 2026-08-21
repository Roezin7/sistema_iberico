# Reconciliación de tickets y FIFO — semana 63

Fecha de revisión: 21 de agosto de 2026  
Periodo: 10–16 de agosto de 2026  
Negocio: Ibérico

## Resultado final

La semana 63 quedó reconstruida como un piloto histórico aislado. No se
crearon movimientos financieros duplicados y la semana 64 no fue consumida ni
alterada por el recálculo.

| Indicador | Resultado |
|---|---:|
| Ventas Epos importadas | 104 líneas |
| Unidades vendidas | 126 |
| Ventas brutas/netas Epos | $9,786.00 |
| Ventas costeadas | 99 |
| Excepciones FIFO | 5 |
| Costo FIFO de ventas | $3,515.2268 |
| Margen bruto provisional antes de gastos | $6,270.7732 |
| Compras y gastos documentados | $7,925.70 |

El margen anterior no debe presentarse como utilidad final: aún debe cruzarse
con sueldos, gastos operativos, merma y el cierre físico de la semana.

## Tickets financieros existentes

Los movimientos ya estaban en la base y no se volvieron a crear:

| Movimiento | Proveedor / referencia | Importe | Tratamiento |
|---:|---|---:|---|
| 1100 | Bodegas Alameda | $2,922.00 | Compra inventariable |
| 1101 | Costco — inventario | $2,697.56 | Compra inventariable |
| 1123 | Costco — no inventariable | $622.44 | Gasto operativo |
| 1102 | La Comer — ticket 23933753 | $1,546.50 | Compra inventariable |
| 1103 | La Comer — arúgula | $137.20 | Compra inventariable |
| **Total** |  | **$7,925.70** |  |

El total de Costco se conserva como $3,320.00, separado entre inventario y
gasto. Los tickets ahora tienen detalle de compra y lotes con referencia
`historico_prueba`; no deben confundirse con compras normales de la semana 64.

## Regularizaciones explícitas

Para que el piloto no ocultara faltantes de inventario inicial, se añadieron
dos grupos auditables de lotes de regularización:

- `AJUSTE-FALTANTES-63`: insumos faltantes que el usuario confirmó como
  existentes al inicio del ejercicio.
- `AJUSTE-FALTANTES-63-2`: limón, agua natural y concentrado de horchata que
  aparecieron al desbloquear recetas posteriores.

Estas filas no son tickets ni gastos. Son una representación explícita del
inventario inicial no contabilizado en el histórico. En una operación real no
se deben crear automáticamente: deben sustituirse por conteo físico o ticket.

## Integridad de la prueba

- Las 104 ventas históricas conservan el periodo importado de Epos.
- El recálculo reinició los lotes históricos antes de consumir para evitar
  dobles descuentos al repetir el script.
- Las 99 ventas costeadas consumieron únicamente lotes `historico_prueba`.
- La semana 64 conservó sus 79 lotes de apertura y 423 unidades agregadas.
- Quedaron 5 excepciones explícitas: piña, michemix, pepino (dos ventas) y
  mozzarella. No se rellenaron con ajustes automáticos.

## Discrepancia que queda documentada

La cifra de $9,786 corresponde al total de filas del BookkeepingReport y es la
fuente de ventas usada por el sistema. El costo FIFO ($3,515.2268) sólo cubre
las recetas verificadas y no debe mezclarse con el total de compras para
calcular utilidad. La rentabilidad completa requiere agregar gastos, sueldos,
merma y el inventario físico final.

## Regla para la semana 64

La semana 64 debe operar con el flujo normal:

1. importar Epos una vez por día;
2. confirmar ventas y métodos de pago;
3. capturar cada ticket real con sus líneas y origen de pago;
4. convertir únicamente compras confirmadas en lotes FIFO;
5. resolver excepciones sin crear ajustes silenciosos;
6. cerrar con conteo físico y usar ese snapshot como apertura de la semana 65.
