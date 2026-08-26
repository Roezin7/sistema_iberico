# Estado de implementación · Ibérico · 26 de agosto de 2026

## Decisión operativa

Ibérico se opera como un ciclo semanal único: abrir la semana, registrar la
operación de viernes a domingo, recibir tickets y gastos, costear ventas con
FIFO en vivo, contar físicamente, explicar diferencias y cerrar. Las semanas
anteriores se consultan sin mezclarse con la semana abierta.

## Lo que queda implementado

- Semana con etiqueta única: `Semana N (inicio → fin)` en Inicio, Entradas,
  Cierre e Inventario.
- Navegación orientada al flujo: Inicio, Entradas, Cierre, Inventario y
  administración; las rutas antiguas siguen funcionando.
- Entradas como fuente única para tickets y gastos: al confirmar un ticket se
  crea el lote FIFO y el movimiento financiero vinculado.
- Tickets, pendientes de revisión y lotes FIFO consultables por semana.
- Conversión de presentación visible antes de guardar (cajas, paquetes,
  botellas, kg, g, ml o piezas), usando el catálogo vigente.
- Prevención de duplicados por folio o hash de fotografía en el servidor.
- FIFO en vivo para ventas importadas de Epos, con reversiones sólo en
  auditoría y excepciones separadas del costo normal.
- Cierre con conciliación independiente FIFO contra inventario físico:
  apertura, compras, ajustes, consumo FIFO, existencia esperada, conteo final,
  diferencia, valor y clasificación de incidencia.
- Inventario con tipo explícito (apertura, cierre, conteo operativo o ajuste),
  historial y unidad de captura por zona.
- Cierre diario con ventas Epos, métodos de pago, propinas, gastos, sueldos y
  detalle de productos.
- Costos del menú ordenados por la carta, mostrando costo FIFO actual, último
  costo aplicado o costo base, margen y food cost.
- Asistente flotante oculto durante las capturas operativas para reducir ruido.

## Qué debe verificarse en operación

Estas comprobaciones requieren datos reales y no se deben simular:

1. Importar una venta Epos en vista previa y después sincronizarla una sola vez.
2. Confirmar un ticket de inventario y comprobar simultáneamente lote FIFO,
   movimiento financiero y consulta del ticket.
3. Capturar apertura y cierre usando la unidad que muestra el formulario.
4. Comparar consumo FIFO activo contra el conteo físico y resolver sólo las
   diferencias clasificadas como conversión, compra faltante, receta, captura
   o posible merma.
5. Cerrar la semana y comprobar que el cierre físico sea la apertura siguiente.

## P1/P2 pendiente de evidencia

- Completar el mapeo de todos los nombres Epos que aparezcan en una semana real.
- Ejecutar sincronización diaria al final de cada día operativo y revisar pagos
  mixtos, propinas y cuentas abiertas.
- Formalizar alertas y tendencias de decisión en Inicio después de varias
  semanas confiables.
- Definir roles adicionales cuando exista un segundo operador; mientras tanto
  el acceso permanece restringido al administrador.

No se requiere una migración de base de datos para estas mejoras de flujo. No se
debe añadir funcionalidad nueva hasta observar un patrón repetido que no pueda
resolverse con el flujo existente.
