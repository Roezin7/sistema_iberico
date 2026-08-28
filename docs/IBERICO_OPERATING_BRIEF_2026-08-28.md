# Operating Brief — Ibérico

**Corte:** 28 de agosto de 2026 · Ciudad de México  
**Semana activa:** Semana 65 (2026-08-24 → 2026-08-30) · abierta  
**Fase:** Fase 0 avanzada: validación operacional real con FIFO continuo. El
objetivo inmediato es cerrar una semana completa sin regularizaciones
artificiales y convertir el resultado en decisiones operativas.

## Objetivo real de la semana

No es solamente “calcular FIFO”. La prueba debe responder:

1. ¿Qué se vendió y por qué método de pago?
2. ¿Qué costo FIFO activo consumieron esas ventas?
3. ¿Qué compras entraron realmente y a qué costo?
4. ¿Qué diferencia existe entre FIFO esperado y conteo físico?
5. ¿La diferencia se explica por conversión, compra faltante, receta, captura o
   posible merma?
6. ¿Cuál fue el resultado operativo después de gastos y sueldos?
7. ¿Qué decisión concreta se debe tomar para mejorar margen, merma o compras?

El criterio de éxito no es que las cifras “cuadren” por construcción, sino que
cada cifra tenga una fuente independiente y una explicación verificable.

## Estado comprobado en producción

| Componente | Estado al corte |
|---|---|
| Semana 65 | Abierta, 24–30 de agosto |
| Inventario de apertura | Snapshot 59, valor $35,266.06 |
| Compras | 1 ticket confirmado, recibido el 27 de agosto |
| Lotes FIFO nuevos | 2 lotes, 48 Pacifico y 48 Ultra |
| Valor del ticket | $1,873.80 |
| Costo unitario de ambos lotes | $19.51875 por pieza |
| Ventas Epos dentro del intervalo local de la semana 65 | 0 al corte |
| Gastos/sueldos registrados en semana 65 | 0 al corte |
| Snapshot de cierre | Aún no existe |

El ticket actual tiene dos líneas: 48 piezas de Pacifico y 48 piezas de Ultra.
Cada línea creó su lote FIFO y el movimiento financiero vinculado; no hay una
segunda entrada del mismo ticket.

### Nota de zona horaria

La base contiene 38 líneas Epos con timestamps del 24 de agosto en UTC, pero
su fecha local en México es el 23 de agosto. Esas ventas pertenecen al domingo
de la semana 64 y no deben contarse como ventas de la semana 65. El sistema debe
mantener esta conversión local al importar y conciliar.

## Qué ya funciona como operación real

- Entrada única de tickets y gastos con vínculo financiero y lote FIFO.
- FIFO continuo: los lotes sobreviven al cambio de semana y se consumen por
  fecha de recepción.
- Reversiones sólo como historial; no vuelven a costo activo.
- Idempotencia para no consumir dos veces una venta al repetir sincronización.
- Separación de flujo de caja, costo FIFO, resultado operativo y patrimonio.
- Snapshot de apertura y cierre por semana; el cierre no usa el último snapshot
  global.
- Conciliación independiente FIFO contra inventario físico.
- Epos en modo lectura/sincronización controlada, con pagos y propinas separados.
- Existencia actual y lista de compras usan el saldo FIFO abierto como
  disponibilidad operativa; el conteo físico se conserva por separado para la
  conciliación. Las entradas nuevas no se suman otra vez al snapshot.

## Lo que debemos hacer durante esta semana

### Viernes y sábado

1. Registrar cada ticket con fecha real, proveedor, líneas, presentación y
   método de pago.
2. Confirmar que cada ticket produzca exactamente un movimiento y un lote por
   producto.
3. Al terminar cada día, ejecutar la sincronización Epos una sola vez.
4. Revisar productos vendidos, efectivo, tarjeta, propinas y cuentas abiertas.
5. Comparar ventas Epos contra el corte diario antes de confirmarlo.
6. Resolver sólo mapeos reales; no crear recetas ni existencias por intuición.

### Domingo

1. Sincronizar las ventas del domingo usando el intervalo local correcto.
2. Confirmar métodos de pago, propinas y cualquier cuenta que se haya cerrado
   después.
3. Capturar el inventario físico de cierre con la unidad/presentación mostrada
   por el formulario.
4. Ejecutar FIFO esperado contra inventario físico.
5. Clasificar cada diferencia como conversión, compra faltante, receta,
   captura o posible merma.
6. Registrar gastos y sueldos sólo una vez, en su fecha real.
7. Calcular costo de ventas FIFO activo, utilidad bruta, resultado operativo,
   flujo de caja y patrimonio por separado.

## Qué debe quedar antes de cerrar la 65

- Todas las ventas locales de viernes–domingo importadas una sola vez.
- Ventas y pagos diarios conciliados, incluyendo propinas y cuentas abiertas.
- Todos los tickets de la semana confirmados o explicitamente pendientes.
- Cada compra confirmada con lote FIFO y movimiento vinculado.
- Inventario físico final capturado como snapshot de cierre de la semana 65.
- Conciliación FIFO vs físico con diferencias clasificadas.
- Costo de ventas basado únicamente en consumo FIFO activo.
- Resultado operativo separado de flujo de caja y patrimonio.
- Lista breve de decisiones: comprar, ajustar presentación, revisar receta,
  investigar merma o no actuar.

## Cómo esta semana moldea las siguientes

- Si un producto vuelve a aparecer como excepción dos semanas seguidas, revisar
  su presentación, conversión o receta antes de llamarlo merma.
- Si una compra se captura sin ticket o fecha real, mejorar el flujo de captura
  móvil; no compensar el inventario manualmente.
- Si ventas y pagos coinciden durante tres días operativos, automatizar la
  sincronización diaria como rutina estable.
- Si el conteo físico y FIFO divergen después de validar conversiones, abrir una
  incidencia de merma con responsable y evidencia.
- Si todos los productos vendidos de la semana tienen receta y lote, el margen
  puede pasar de “provisional” a utilizable para decisiones.

## Estado de madurez

La arquitectura ya es suficientemente completa para operar. Lo que todavía no
está demostrado es la repetición del ciclo durante varias semanas con datos
vivos y sin ajustes manuales. Por eso el trabajo prioritario no es añadir
módulos: es completar la semana 65, explicar sus diferencias y conservar la
evidencia para comparar contra la 66.

## Pendientes no bloqueantes

- Completar IDs externos de Epos cuando estén disponibles; los nombres
  normalizados ya permiten resolver el costeo histórico.
- Ejecutar el respaldo también desde el contenedor de Coolify para conservar la
  copia en el mismo entorno.
- Automatizar OCR de tickets sólo después de observar qué campos se repiten y
  cuáles requieren revisión humana.

## Verificación puntual de la existencia actual

Para la semana 65, las compras confirmadas del ticket del 27 de agosto deben
aparecer inmediatamente como lotes abiertos en Existencia actual. Pacifico y
Ultra entraron con 48 piezas cada uno; la pantalla debe mostrar esas cantidades
como “FIFO actual”, sin alterar el conteo físico de apertura. Si un producto no
tiene lotes FIFO abiertos, la pantalla conserva su último conteo físico y lo
marca como tal.
