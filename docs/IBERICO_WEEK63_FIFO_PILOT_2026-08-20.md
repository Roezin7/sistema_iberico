# Piloto FIFO histórico — semana 63

Fecha de ejecución documentada: 20 de agosto de 2026  
Revisión de base: 21 de agosto de 2026  
Periodo de ventas: 10–16 de agosto de 2026  
Negocio: Ibérico

## Alcance

La semana 63 se costeó en modo `historico_prueba`. El sistema materializó el
snapshot de apertura 49 en lotes con referencia `APERTURA-FIFO-HISTORICO-63` y
fuente `historico_prueba`. Estos lotes no participan en el FIFO normal.

Para esta reconstrucción se aplicaron conversiones históricas confirmadas:

- Sprite: 1.7 L.
- Schweppes/Tónica: paquete de 6 × 296 ml (1,776 ml).
- Arriero: botella de 840 ml.
- Agua mineral: paquete de 6 × 1 L.
- El resto utiliza el `contenido_compra` vigente del catálogo.

La semana 64 no se modificó: sus 79 lotes de apertura conservaron 423 unidades
restantes antes y después de la prueba.

## Resultado

- Ventas Epos importadas: 104.
- Ventas costeadas con existencia histórica: 55 (estado verificado el 21 de agosto).
- Costo FIFO aplicado actualmente: $1,861.4069 MXN.
- Excepciones por inventario insuficiente: 33 (estado verificado el 21 de agosto).
- Consumos históricos registrados: 219 líneas.
- Cantidad consumida de lotes históricos: 15,580.18 unidades base.
- Valor inicial de lotes históricos: $35,897.00 MXN.

Las excepciones se registraron sin consumir lotes de la semana 64. Los tickets
del 11 de agosto sí existen como movimientos financieros de la semana 63 por
$7,925.70. Sin embargo, la base actual no conserva el detalle de esos tickets
como `purchases/purchase_lines` ni como lotes FIFO asociados. Las compras
detalladas que aparecen como registros de compra son las del 20 de agosto y
pertenecen a la semana 64. Por eso el costo mostrado aquí todavía no puede
considerarse FIFO real por compra: utiliza la apertura histórica y los ajustes
explícitos, separados de los movimientos financieros.

## Criterio aplicado

El piloto respeta FIFO por fecha de recepción y costo unitario del snapshot.
Las ventas sin existencia suficiente permanecen como `excepcion`; deberán
resolverse con compras históricas, conversiones de unidad o correcciones de
inventario antes de usarse para un margen real.

## Siguiente acción

Reconstruir de forma idempotente el detalle de los cuatro tickets ya
documentados, enlazándolos a los movimientos financieros existentes y creando
sus lotes históricos. Después se reemplazarán únicamente los ajustes que queden
cubiertos por compras reales y se repetirá el costeo. La semana 64 debe
permanecer intacta.
