# Piloto FIFO histórico — semana 63

Fecha de ejecución: 20 de agosto de 2026  
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
- Ventas costeadas con existencia histórica: 64.
- Costo FIFO aplicado: $2,101.4883 MXN.
- Excepciones por inventario insuficiente: 40.
- Consumos históricos registrados: 219 líneas.
- Cantidad consumida de lotes históricos: 15,580.18 unidades base.
- Valor inicial de lotes históricos: $35,897.00 MXN.

Las excepciones se registraron sin consumir lotes de la semana 64. No existen
compras registradas del 10–16 de agosto en producción; las compras actualmente
registradas son del 20 de agosto. Por eso no se incorporaron facturas que no
existen. Se conserva un ajuste histórico explícito de faltantes para la prueba,
separado de compras reales.

## Criterio aplicado

El piloto respeta FIFO por fecha de recepción y costo unitario del snapshot.
Las ventas sin existencia suficiente permanecen como `excepcion`; deberán
resolverse con compras históricas, conversiones de unidad o correcciones de
inventario antes de usarse para un margen real.

## Siguiente acción

Obtener los tickets reales del 10–16 de agosto y sustituir el ajuste histórico
por compras confirmadas. Las 40 excepciones restantes corresponden sobre todo
a limón, romero, mozzarella, hierbabuena, saborizante, fresas, lechera y
Squirt. Sólo después de resolverlas debe cerrarse el margen de la semana.
