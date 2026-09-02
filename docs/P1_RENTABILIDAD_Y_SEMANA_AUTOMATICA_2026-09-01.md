# P1 — continuidad semanal y rentabilidad histórica

Fecha: 2026-09-01

## Continuidad de la operación

Al cerrar una semana, el servidor crea (o reutiliza) la semana siguiente dentro de la misma transacción. La nueva semana queda abierta y su apertura de inventario apunta al snapshot físico oficial recién cerrado, con su valor congelado. Si el lunes ya se había creado manualmente, no se sobreescribe su apertura.

La pantalla **Semana** se posiciona automáticamente en esa nueva semana después del cierre. Las semanas anteriores siguen disponibles mediante el selector o una URL explícita.

## Rentabilidad histórica

Se expone `GET /api/finanzas/estado-resultados?meses=6`, exclusivo para administradores. Agrupa el P&L por mes calendario y muestra:

- ventas netas, costo de ventas y utilidad operativa;
- sueldos y gastos acumulados;
- margen operativo;
- variación de inventario cuando existe snapshot;
- método de costo usado: FIFO, inventario o compras.

La vista se integra en **Menú y rentabilidad** para comparar la carta vigente con el desempeño histórico sin crear otro módulo independiente. El mes actual queda marcado como parcial.

## Control y límites

- El costo FIFO activo es la fuente preferida; inventario y compras sólo respaldan meses sin ledger FIFO.
- La creación automática no modifica semanas existentes ni snapshots históricos.
- El cierre continúa bloqueado por inventario físico faltante o excepciones de costeo.
