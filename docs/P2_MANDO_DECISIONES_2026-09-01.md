# P2 — mando de decisiones y salud operativa

Fecha: 2026-09-01

## Mando de decisiones

La nueva pantalla **Decisiones** consolida las últimas ocho semanas y muestra:

- ventas, food cost y margen operativo;
- rotación semanal y cobertura estimada de inventario;
- estado de verificación de cada semana;
- alertas por aumento de food cost, baja rotación y diferencias recurrentes;
- cola de incidencias con semana, responsable, fecha límite y acción sugerida.

Endpoint administrativo: `GET /api/finanzas/tablero-decisiones?semanas=8`.

El cálculo no crea un inventario alterno. La existencia final proviene del
conteo físico; FIFO sólo aporta costo y consumo para las métricas de auditoría.

## Continuidad probada

Se amplió la prueba FIFO con el contrato operativo compra → venta → cierre →
apertura siguiente. La prueba verifica consumo, costo aplicado y que la
apertura siguiente conserve la cantidad física del cierre.

Las pruebas actuales: 114; build cliente y servidor correcto.

## Contrato HTTP

`http-contract.test.ts` levanta la aplicación en un puerto efímero y verifica
que el mando de decisiones y los snapshots de inventario devuelvan `401` y
JSON cuando no hay sesión. La app puede importarse en pruebas sin abrir un
listener normal mediante `IBERICO_NO_LISTEN=1`.

Queda para una fase posterior una prueba HTTP/browser autenticada contra una
base efímera que recorra el cierre real y valide reintentos y rollback. El
mando actual ya es de sólo lectura y no cambia datos de producción.
