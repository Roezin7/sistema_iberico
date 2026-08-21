# Piloto FIFO histórico — semana 63

Fecha de ejecución: 20 de agosto de 2026  
Periodo de ventas: 10–16 de agosto de 2026  
Negocio: Ibérico

## Alcance

La semana 63 se costeó en modo `historico_prueba`. El sistema materializó el
snapshot de apertura 49 en lotes con referencia `APERTURA-FIFO-HISTORICO-63` y
fuente `historico_prueba`. Estos lotes no participan en el FIFO normal.

La semana 64 no se modificó: sus 79 lotes de apertura conservaron 423 unidades
restantes antes y después de la prueba.

## Resultado

- Ventas Epos importadas: 104.
- Ventas costeadas con existencia histórica: 8.
- Costo FIFO aplicado: $190.00 MXN.
- Excepciones por inventario insuficiente: 96.
- Consumos históricos registrados: 8.
- Cantidad consumida de lotes históricos: 10 unidades base.
- Valor inicial de lotes históricos: $35,897.00 MXN.

Las excepciones se registraron sin inventar existencia ni consumir lotes de la
semana 64. Las causas principales fueron faltantes de harina, limón, frutos
rojos, alcoholes, nieve, pan, papas y otros insumos.

## Criterio aplicado

El piloto respeta FIFO por fecha de recepción y costo unitario del snapshot.
Las ventas sin existencia suficiente permanecen como `excepcion`; deberán
resolverse con compras históricas, conversiones de unidad o correcciones de
inventario antes de usarse para un margen real.

## Siguiente acción

Completar las conversiones de presentación que afectan el snapshot (por
ejemplo, cajas/paquetes frente a gramos o mililitros), importar las compras de
la semana 63 si existen y repetir la vista previa. Sólo después de eliminar
las excepciones justificadas debe cerrarse el margen de la semana.
