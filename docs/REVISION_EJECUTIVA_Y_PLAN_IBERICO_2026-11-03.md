# Ibérico — revisión ejecutiva, entrega y plan de operación

Fecha: 3 de noviembre de 2026. Evidencia: producción `iberico.buzz`, consultas PostgreSQL en transacción de sólo lectura, código de `main`, copia local restaurada y pruebas de navegador. Las pruebas con compras/ventas sintéticas se hicieron exclusivamente en la copia local.

## Decisión ejecutiva

Ibérico necesita consolidar cuatro espacios: **Operación, Abasto, Finanzas y Administración**. Hay funcionalidad suficiente para operar el negocio; la prioridad es asegurar la calidad de cada dato y reducir el esfuerzo de captura. Un módulo adicional de IA, marketing o reportes no resuelve un ticket mal convertido o un cierre sin conciliación.

Evaluación de entrada: **5.0/10**. Evaluación tras esta entrega: **6.6/10** (redondeable a 6.5). Es juicio técnico y operativo sobre la evidencia; no es porcentaje de código terminado ni medición de satisfacción del equipo. El límite principal sigue siendo la confiabilidad de los datos históricos y de los cortes de inventario.

| Dimensión | Peso | Antes | Después | Evidencia / límite |
| --- | ---: | ---: | ---: | --- |
| Lógica y protección de operaciones | 25% | 6 | 7.5 | Validación común de presentaciones; lotes separados por línea; ajustes puntuales conservan otros productos. Pendiente precisión temporal por zona y recepción de compras. |
| Confianza de los datos | 25% | 4.5 | 4.5 | Todas las ventas tienen costo, pero persisten diferencias físicas y precios de menú faltantes. |
| Claridad de uso | 20% | 4 | 8 | Captura accesible, editor compartido, borrador persistente, cuenta móvil y checklist recuperados. Falta prueba de uso con quien opera el local. |
| Verificación y recuperación | 15% | 5.5 | 8 | 131 pruebas pasan; API con copia restaurada; navegador en 360/390/1440 px; restauración real del respaldo. Falta demostrar respaldo programado con alertas. |
| Replicabilidad | 15% | 4.5 | 5.5 | Separación por negocio y catálogos configurables. Persisten identidad, horarios, comisiones y conexión Epos particulares. |

Objetivo alcanzable: **8/10 después de dos cierres consecutivos conciliados y un ensayo de réplica**. No se debe prometer 10/10 por desaparecer alertas: los pendientes deben resolverse con evidencia.

## Lo que existe realmente

Al inicio de la revisión: 105 insumos activos; 100 artículos activos del menú; 1,261 líneas de venta Epos con estado costeada y costo no nulo; 95 compras confirmadas y ninguna por revisar. Todos los insumos activos tienen categoría, zona y conversión. No se encontraron saldos de lotes negativos, saldos superiores al inicial, ventas/consumos/lotes sin negocio ni duplicados de consumo por venta/producto/lote.

Esto acredita integridad básica, no exactitud física. Para la semana 44 (26 de octubre–1 de noviembre), todavía abierta:

| Señal | Valor observado | Interpretación |
| --- | ---: | --- |
| Ventas manuales confirmadas | $14,075 | Fuente financiera semanal; requiere contraste con cortes Epos completos. |
| Consumo FIFO registrado | $5,512.04 | Costo teórico registrado. La etiqueta costeada no valida por sí sola la receta ni el tamaño del envase. |
| Diferencia física semanal valorizada | -$4,144.58 | Incidencia a explicar; no equivale automáticamente a merma ni robo. |
| Diferencia histórica de apertura | -$6,100.96 | Arrastre anterior, separado del residuo semanal. |
| Caja: contado menos teórico | +$315.50 | Falta conciliación de dinero. |
| Banco | Sin arqueo | El saldo real no puede darse por confirmado. |
| Menú sin precio de referencia | 10 artículos | No es posible evaluar todos los márgenes del menú. |
| Servicios sin ID Epos | 6 al inicio | Bacardi tiene una coincidencia exacta documentada; los demás requieren catálogo Epos verificable. |

Los diez artículos sin precio son Café americano, Gomitas, Jim Beam Rocas, Shot de 400 Conejos y los servicios de Bacardi, Tequila, 1800, Tequila 8, Dobel y Hacienda. No se infirió el precio vigente de una venta histórica con posibles promociones.

## Plan de esta entrega: ejecutado paso a paso

1. **Revisar producción y recuperar una copia comprobable.** Se creó un dump de PostgreSQL 18, se restauró en una base local aislada y se comprobaron sus tablas. El script ahora admite indicar los binarios de PostgreSQL; el cliente 16 instalado por defecto no puede respaldar un servidor 18.
2. **Acortar Compras sin añadir pantallas.** La lista de faltantes se conserva en un desplegable con enlace directo desde Operación. El formulario ya no queda detrás de miles de píxeles de productos. La captura prioriza fecha, proveedor, cuenta de pago, producto, cantidad, tamaño e importe. Folio y notas son secundarios.
3. **Unificar alta, revisión y edición.** Los tres flujos utilizan el mismo editor de artículo. Se retiró un editor antiguo duplicado. La revisión tiene un paso explícito de confirmación después de mostrar advertencias.
4. **Evitar supuestos económicos.** Se eliminó el autollenado del importe con precios históricos y la selección silenciosa de Caja en compras nuevas. Un mezclador exige el tamaño de esa compra. El peso variable requiere cantidad explícita. El OCR propone contenido visible y conserva null cuando falta; la lectura real con el proveedor de IA queda pendiente de prueba con un recibo autorizado.
5. **Conservar cantidades y costos.** Dos tamaños de un producto en un ticket generan lotes separados con su importe/cantidad. La línea resumen se marca mixta. Validación, confirmación, edición y registro directo rechazan inconsistencias. Editar una compra no aumenta artificialmente las observaciones de presentaciones.
6. **Proteger el conteo físico.** Los productos con contenido variable se cuentan en litros/kilos o cantidad base explícita. La vista que mantiene conversiones operativas las identifica como equivalencias. Un peso explícito se guarda con factor 1 para evitar redondearlo a fracciones de envase. Un ajuste puntual conserva el saldo de los otros productos de la zona.
7. **Recuperar funciones perdidas.** Checklist vuelve a Operación. Cuenta móvil permite salir y cambiar tema. Los enlaces de alertas llevan al filtro correspondiente. Finanzas permite reintentar una carga fallida. Las pestañas de Abasto conservan la selección en la URL.
8. **Hacer visibles pendientes reales.** Operación advierte diferencias de inventario y arqueos; la salud incluye menú sin precio y semana vencida. Un borrador sin red se identifica como local, no como inventario confirmado.
9. **Corregir evidencia inequívoca.** Dobel Diamante Botella y Servicio Dobel todavía consumían 750 ml pese a la confirmación de 700 ml. Se crearon versiones nuevas vigentes desde el 3 de noviembre; se conservaron las anteriores.
10. **Verificar y preparar mantenimiento.** Se agregaron controles automáticos de tipos, pruebas y compilación en GitHub Actions, un archivo público de versión de compilación y una auditoría SQL repetible de sólo lectura.

Pruebas observadas: 131/131 en 13 suites; tipos de cliente y compilación de ambos proyectos; prueba de API con compra mixta, validaciones, costos por lote, un solo pago, segundo intento de confirmación, edición, continuación de zonas, ajuste puntual y ventas importadas tarde; navegador sin errores JavaScript ni desborde horizontal a 360/390/1440 px. El borrador de compra conserva datos al recargar y 20 g explícitos permanecen en 20 g. El formulario aparece aproximadamente a 587 px en móvil de 390 px, antes detrás de toda la lista de compras.

## Lo ambiguo o incompleto que todavía importa

- **Corte de tiempo por zona.** La consulta actual utiliza una referencia temporal global del inventario. Guardar Bodega y Local con actividad entre ambos guardados requiere una hora efectiva independiente por zona. La prueba de continuación acredita asociación y conservación; no acredita todos los escenarios de ventas durante el conteo.
- **Hora real de recepción.** Las compras guardan fecha civil, pero no siempre hora efectiva de llegada. Un ticket capturado después del conteo podría corresponder a insumos que ya estaban contados. No basta usar la hora de captura para resolverlo.
- **Registro sin folio/foto y reconexión.** La confirmación tiene protección contra repetición. La creación de una captura sin identificador estable necesita una clave de idempotencia para cubrir respuesta perdida y reintentos de red.
- **Presentaciones históricas.** El catálogo de variantes recopila observaciones; no convierte datos antiguos en evidencia validada. Bacardi tiene formatos históricos de 980 ml y recibos de 700 ml; Ginebra de 700 y 1,000 ml. Una marca de alcohol tampoco garantiza siempre el tamaño. Auditar primero los lotes que siguen abiertos.
- **Transferencias Bodega–Local.** Se transfieren lotes completos y parte del reparto de consumos por zona es teórico. Falta un flujo sencillo de reposición parcial con trazabilidad y sin simular una compra.
- **Fecha del conteo vs fecha de la semana.** Un cierre contado el lunes no demuestra por sí mismo el físico del domingo. Debe conservarse el momento efectivo que confirma el operador.
- **Menú/servicios.** Tequila genérico, Tequila 8 y marcas particulares requieren identificar SKU, receta y precio por servicio. Una coincidencia de nombre o un margen calculado no sustituye esa decisión. Smothie Spritz está inactivo pero tiene ventas históricas: requiere interpretación histórica, no reactivación automática.
- **Finanzas.** Flujo de caja, utilidad FIFO provisional y resultado confirmado son métricas distintas. Los márgenes deben leerse como provisionales mientras falten arqueos y conciliación física.
- **Replicabilidad.** La app usa separación por negocio, pero conserva login del negocio inicial, marca, MXN, horarios y reglas particulares. No es todavía un producto listo para copiar a cualquier restaurante sin adaptación.
- **Operación continua.** No se verificó una programación externa de backups, alertas de fallos o restauraciones periódicas. La existencia de un script no acredita que alguien lo ejecute.

## Plan de acción de las siguientes cuatro semanas

Capacidad recomendada: 6–10 horas técnicas semanales y 10–15 minutos del responsable al terminar cada jornada operativa. Los eventos extraordinarios también necesitan corte; no se asumirá que sólo se vende viernes–domingo.

| Periodo | Objetivo realista | Responsable | Criterio de terminado |
| --- | --- | --- | --- |
| 3–8 noviembre | Cerrar la semana 44 con evidencia y operar la 45 sin nuevos arrastres | Arturo/Mauri + soporte técnico | Explicar los $315.50, capturar Banco real, revisar las 10 diferencias de inventario con mayor impacto y confirmar precios/SKU de servicios. Cada diferencia conserva causa y responsable; no se crean compras para taparla. |
| 9–15 noviembre | Resolver tiempos y reintentos del núcleo | Desarrollo | Hora efectiva por zona y recepción; pruebas con ventas entre guardados y compras capturadas tarde; clave idempotente de captura. Dos intentos producen una sola captura y un solo efecto contable. |
| 16–22 noviembre | Ajustar abasto con consumo confiable | Operación + desarrollo | Medir artículos que explican al menos 80% del consumo valorizado. Proponer coberturas y presentaciones, revisar mínimos con el dueño y registrar agotados/merma. No reducir stock sólo porque el histórico esté incompleto. |
| 23–29 noviembre | Ensayar réplica y recuperación | Desarrollo + dueño | Crear un negocio de prueba con configuración exportable y sin datos de Ibérico; completar compra → venta → conteo → arqueo → cierre; restaurar un respaldo y documentar el procedimiento. |

La primera semana puede requerir más tiempo por el saneamiento inicial. Si la capacidad es menor, se mantienen pendientes explícitos y se retrasa la optimización de compras y eventos; no se salta la conciliación.

## Medidas para saber si mejora el negocio

- Medir tiempo de captura de cinco tickets reales: meta de menos de 2 minutos para tickets simples y menos de 5 para mixtos, sin ayuda técnica. Aún no es una medición conseguida.
- Al menos 95% de compras registradas en 24 horas y 100% de jornadas vendidas con corte confirmado. Primero obtener una semana de línea base.
- Diferencias de dinero explicadas con evidencia; los ajustes contables siempre conservan motivo. No establecer una tolerancia que oculte pérdidas.
- Reducir la diferencia física no explicada a menos del 5% del consumo valorizado en dos cierres consecutivos; es meta, no estado actual ni garantía.
- Mantener cero ventas nuevas sin costeo al terminar cada jornada. Distinguir error técnico, receta, lote y dato del proveedor.
- Proponer un presupuesto de abasto y medir compras fuera de lista. Para perecederos, revisar consumo y merma semanalmente; para alcohol y mezcladores, cobertura y formato real. Revisar los mínimos existentes con el dueño antes de modificarlos.
- El objetivo de reducir capital inmovilizado 10–15% es un experimento posterior a la limpieza, condicionado a no aumentar agotados. No comprar por debajo del mínimo operativo confirmado sólo por optimizar el indicador.

## Ventas y eventos

Antes de aumentar exposición, fijar un margen de contribución confiable por producto y la capacidad real de barra/cocina. Después, probar **un solo formato de evento a la vez**: reservación de grupo en jueves o noche temática de baja complejidad con menú corto y compra separada.

Cada piloto registra ingreso incremental, insumos, personal adicional, comisiones, promoción y desperdicio; se compara contribución y horas de trabajo con una jornada comparable. Dos pilotos con contribución positiva y sin deterioro operativo permiten repetirlo. No se propone un descuento general ni publicidad pagada recurrente con márgenes provisionales.

## Regla de diseño y mantenimiento

Conservar las cuatro secciones actuales. Operación muestra próximos pasos; Abasto recibe y cuenta; Finanzas concilia y cierra; Administración configura. Los detalles técnicos se abren cuando ayudan a decidir. Marketing e IA quedan secundarios hasta que compras, caja e inventario concilien durante dos semanas.

Cada cambio de código debe pasar tipos, pruebas, compilación y una comprobación del flujo afectado. Verificar `/version.json` y `/api/health` después de desplegar. La auditoría se repite con `scripts/auditar-produccion-readonly.sql`; la prueba con escritura sólo acepta una base local cuyo nombre contiene audit/test. El backup y la copia local contienen datos del negocio y no se publican en Git.
