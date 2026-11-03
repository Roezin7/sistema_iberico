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

Tras desplegar la entrega se vinculó Servicio Bacardi al ID Epos 4055736. Una segunda revisión consultó directamente los **132 productos de Epos**, usando las credenciales protegidas del servidor, no únicamente las ventas importadas. Se aplicaron siete conciliaciones locales y se separó Shot Jim Beam de Rocas; se conservaron ventas, lotes y costos históricos. Los detalles y las decisiones restantes están al final de este documento.

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

Pruebas observadas: 131/131 en 13 suites; tipos de cliente y compilación de ambos proyectos; prueba de API con compra mixta, validaciones, costos por lote, un solo pago, segundo intento de confirmación, edición, continuación de zonas, ajuste puntual y ventas importadas tarde; navegador sin errores JavaScript ni desborde horizontal a 360/390/1440 px. También se completó en navegador el recorrido captura → revisión explícita → confirmación, exclusivamente en la copia local. El borrador de compra conserva datos al recargar y 20 g explícitos permanecen en 20 g. El formulario aparece aproximadamente a 587 px en móvil de 390 px, antes detrás de toda la lista de compras.

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

## Evidencia de entrega

Código publicado: `93679f4`. El [control de calidad de GitHub Actions](https://github.com/Roezin7/sistema_iberico/actions/runs/41589082341) terminó correctamente. Producción respondió con la nueva salud operativa, cinco vínculos pendientes y el archivo de compilación generado a las 06:20:12 UTC del 3 de noviembre. La imagen actual no informa el hash de Git en ese archivo (`revision=unknown`); la fecha de compilación y las respuestas se contrastaron con la entrega. Exponer el hash exacto requiere pasar SOURCE_COMMIT desde el entorno de despliegue.

## Conciliación directa de Epos y recetas — 3 de noviembre

Esta consulta corrige el alcance de la revisión inicial: sí hay acceso al catálogo remoto completo desde el servidor. No fue necesario pedir al dueño precios que Epos ya proporciona. Sólo se leyó Epos; los cambios se hicieron en Ibérico, en transacción y con ocho entradas de bitácora. La operación está documentada en `server/scripts/conciliar-menu-epos-2026-11-03.mjs`, con vista previa por defecto y comprobación de ID, nombre remoto, precio y ausencia de duplicados activos.

| Artículo | ID Epos vigente | Precio Epos aplicado | Costo FIFO registrado de receta vigente |
| --- | ---: | ---: | ---: |
| Café americano | 3978590 | $45 | $4.22 |
| Shot de 400 Conejos | 2364539 | $70 | $49.85 |
| Servicio Bacardi | 4055736 | $900 | $350.03 |
| Servicio Hacienda de Tepa | 2364534 | $700 | $328.85 |
| Jim Beam Rocas | 3632848 | $80 | $34.62 |
| Shot Jim Beam whiskey | 4040675 | $70 | $34.62 |
| Servicio Jim Beam | 4040672 | $830 | $439.00, sólo botella en receta actual |
| Cuba de Dobel Diamante | 3504178 | $140 | Consultable en menú |

Rocas estaba asociado incorrectamente al shot. Se corrigió y se creó el artículo específico Shot Jim Beam whiskey con la receta de 2 oz confirmada por el propietario, vigente desde el 3 de noviembre. Servicio Jim Beam tenía un ID histórico no incluido en el catálogo actual y precio $600; el SKU vigente es “Servicio Jim Bean ACTUALIZADO”, $830. Cuba Dobel estaba en $110 localmente frente a $140 en Epos. No se recalcularon ventas históricas ni se cambiaron los precios del punto de venta.

**El costo registrado todavía no equivale al costo validado.** Los $350.03 de Bacardi usan la receta de 750 ml y los lotes actuales. El ticket de La Comer del 20 de octubre dice Bacardi y Jim Beam de 700 ml, pero ambas líneas quedaron con 750 ml y 1,500 ml para dos botellas. Dobel también conserva un lote de 750 ml de la compra del 27 de octubre pese a la presentación confirmada de 700 ml. Jim Beam ya tiene consumos; no debe editarse el lote sin una corrección trazable que separe cantidad, valoración y consumos previos. Además, Servicio Jim Beam todavía sólo contiene la botella: no es comparable con los servicios que incluyen mezcladores.

Con los tickets adjuntos, los mezcladores de un servicio cuestan **$145 de reposición**: cinco Topo Chico de 600 ml a $22 ($110) y dos Coca de 450 ml a $17.50 ($35). El FIFO actual de esos mismos 3,000 ml + dos piezas es distinto porque toma primero lotes anteriores. Bacardi de la compra promocionada cuesta $243.75 por botella: **$388.75 por servicio a esos precios de compra**, no utilidad neta ni garantía del costo de cualquier lote futuro. Jim Beam de 700 ml cuesta $439 por botella: $584 con esos mezcladores, sujeto a confirmar que el servicio Jim Beam incluye ese acompañamiento.

Pendientes que sí requieren definición, no buscar nuevamente precios:

- Epos ya tiene 1800 Cristalino Botella (3036870, $1,950), Dobel Diamante Botella (3036867, $1,750) y Tequila 8 Botella (3273776, $1,750). Cada ID ya pertenece al artículo Botella local. Para asociar su Servicio hay que confirmar si es el mismo servicio completo y consolidar los duplicados, o si son dos ofertas distintas. No se duplicaron ID ni se publicaron nuevos productos remotos.
- Servicio Tequila es un alias genérico local de Tequila Ocho según su propia receta; no existe como SKU independiente en Epos. Debe consolidarse con la decisión anterior, no inventar un ID.
- Gomitas no aparece en los 132 productos remotos. El ID local 0 no es válido como vínculo Epos. Las dos ventas manuales suman $75 para dos piezas, lo que no acredita un precio vigente único; el costo FIFO sí es $28 por pieza.

Estado tras la conciliación inicial, antes de confirmar la unificación: 101 artículos activos, 1,261/1,261 ventas todavía costeadas, ninguna compra ni venta pendiente; cinco artículos sin precio local (los tres servicios duplicados, el genérico y Gomitas). La salud contaba cuatro ID nulos; adicionalmente debe considerarse inválido el ID 0 de Gomitas.

### Unificación confirmada y aplicada en producción

El propietario confirmó explícitamente que 1800 Cristalino Botella, Dobel Diamante Botella y Tequila 8 Botella son los servicios completos. Se conservaron esos tres registros como principales, con sus ID Epos y precios vigentes, y se desactivaron (sin borrar) los tres duplicados locales llamados Servicio. Los nombres principales coinciden con Epos; sus recetas y notas especifican que incluyen el servicio completo.

| Principal activo | ID Epos | Precio | Receta vigente desde el 3 de noviembre |
| --- | ---: | ---: | --- |
| 1800 Cristalino Botella | 3036870 | $1,950 | 700 ml de 1800 + 3,000 ml de mineral + 2 Coca |
| Dobel Diamante Botella | 3036867 | $1,750 | 700 ml de Dobel + 3,000 ml de mineral + 2 Coca |
| Tequila 8 Botella | 3273776 | $1,750 | 1 botella de Tequila Ocho + 3,000 ml de mineral + 2 Coca |

Cada receta especifica cinco minerales de 600 ml y dos refrescos de 450 ml. Se crearon tres versiones nuevas y tres eventos de bitácora, conservando íntegramente las versiones anteriores. La comprobación comparó huellas completas antes/después: las 1,261 ventas, 1,082 lotes, 6,446 consumos y 1,283 movimientos permanecieron sin cambios. Una segunda ejecución no creó recetas ni eventos adicionales. La API de producción muestra los tres principales con sus tres ingredientes, sin duplicados activos ni ID repetidos.

Estado actual: 98 artículos activos, dos precios pendientes (Servicio Tequila genérico y Gomitas) y un ID nulo (Servicio Tequila); Gomitas conserva el ID 0 inválido ya señalado. El alias genérico no se retiró como parte de la autorización de estos tres servicios. El FIFO vigente devuelve $1,049.64 para 1800 y $898.06 para Dobel, todavía sujeto a las discrepancias de lotes documentadas. Para Tequila Ocho no alcanza el FIFO de una botella: falta 0.75 pieza; no se creó existencia ficticia para cubrirla.

Operación repetible: `server/scripts/unificar-servicios-tequila-2026-11-03.mjs` (vista previa por defecto; `--apply` valida y aplica localmente en transacción, con Epos sólo de lectura).

### Correcciones de entradas y acuerdos posteriores del propietario

Se corrigieron tres entradas con sus importes originales, sin tocar pagos ni volver a descontar consumos:

| Entrada | Cantidad anterior | Cantidad corregida | Saldo del lote tras corregir | Importe conservado |
| --- | ---: | ---: | ---: | ---: |
| Bacardi, compra #91 | 1,500 ml | 1,400 ml (2 × 700) | 1,400 ml | $487.50 |
| Jim Beam, compra #91 | 1,500 ml | 1,400 ml (2 × 700) | 1,281.706 ml | $878.00 |
| Dobel, compra #99 | 750 ml | 700 ml | 700 ml | $849.00 |

Jim Beam conserva exactamente los 118.294 ml ya consumidos. Las dos ventas anteriores conservan sus costos; la diferencia de costo histórica no reexpresada es **$4.9458** y está explícita en la bitácora del lote #1242. No se inventó un gasto en efectivo para absorberla ni se reabrió una semana cerrada. Esta diferencia queda como conciliación de valoración, separada de los $315.50 de Caja.

Bacardi y Jim Beam ahora exigen contenido por compra, porque la evidencia demuestra que no se debe asumir 750 ml para cualquier botella. El catálogo de referencia y las futuras unidades de captura usan 700 ml; los factores guardados en conteos históricos permanecen intactos. La interpretación física de aquellos conteos requiere validación del operador; cambiar el catálogo no convierte retroactivamente una medición antigua en un conteo verificado de 700 ml.

Servicio Bacardi y Servicio Jim Beam tienen nuevas versiones prospectivas: botella de 700 ml + cinco minerales de 600 ml + dos Coca de 450 ml. Las versiones anteriores se conservaron. Los otros tres servicios de tequila mantienen la unificación aprobada.

El propietario confirmó **Gomitas a $35** y pidió **desactivar Servicio Tequila genérico**: ambas acciones están aplicadas con bitácora, sin reescribir ventas anteriores. Gomitas tiene costo FIFO $28 y margen bruto de insumos $7 (20% del precio), antes de personal, comisiones y otros gastos. Sigue sin existir como SKU independiente en el catálogo remoto; no se inventó un ID.

El propietario indicó dejar **el cierre financiero pendiente**, porque aún espera la liquidación bancaria y refiere el feriado. Semana 44 sigue abierta. No se registró Banco teórico como arqueo real ni se dio por explicado el sobrante de Caja por ese motivo. Caja Fuerte Mauri también sigue pendiente de confirmación.

El último cierre físico registrado tiene **Tequila Ocho en cero, Local y Bodega**. El saldo FIFO de 0.25 botella es una discrepancia de auditoría, no evidencia para agregar 0.75 botella ni una compra inexistente.

#### Protección de valoración histórica

Se detectó una falla adicional: el costo histórico conservaba precio, pero dividía entre la presentación actual. Cambiar 750 a 700 ml podía revaluar un cierre anterior aunque su conteo no se hubiera editado. La referencia histórica ahora conserva precio, contenido, unidad, fuente y hora efectiva. La edición del catálogo guarda el antes y después dentro de la misma transacción. La valoración de snapshots y los ajustes documentados comparten esta lógica.

Para las correcciones ya aplicadas se recuperó el formato anterior desde su bitácora. La referencia inicial de catálogo usa una vigencia técnica de inicio, identificada expresamente como **referencia legada, no ticket ni compra**, y no altera la fecha de ninguna compra. Los costos desconocidos permanecen desconocidos; no se sustituyen por el precio actual.

Verificación: **139 pruebas en 15 suites**, tipos y compilación; integración con rollback para cambio de precio/formato dentro del mismo día; 93 snapshots de la copia de trabajo conservan exactamente la valoración anterior al centavo. Se creó otro respaldo de producción y se restauró en una segunda base aislada para ensayar la migración completa y la recuperación de referencias desde bitácora. Las pruebas no escriben en producción.

Pendientes de alcance real: liquidación/arqueos y diferencias físicas; conciliación de los $4.9458 históricos; hora efectiva por zona y recepción de compras; la compra #91 conserva una fecha operativa asumida del 22 de octubre aunque el recibo indica el 20. No se modificaron cortes diarios de una semana cerrada como efecto secundario de corregir sus mililitros.

### Bloque siguiente: cortes independientes y recepción real

Implementación del 3 de noviembre, posterior a las secciones anteriores. Resuelve los puntos de hora efectiva por zona y hora de recepción; no declara resueltos los demás pendientes.

- Cada zona conserva su momento efectivo de conteo. Se puede indicar una hora anterior o dejarla vacía para usar la hora de guardar esa zona. Continuar Local no mueve la hora de Bodega. El conteo oficial se recupera al recargar, incluyendo aperturas heredadas de un cierre previo. Una zona ya guardada se corrige mediante ajuste documentado, no sobrescribiendo el conteo original.
- Una venta ocurrida antes o exactamente en el corte Local ya está contemplada; una posterior sí se descuenta, independientemente del momento de importar Epos. Si se agotó el saldo físico antes de una compra posterior, esa compra no cubre retroactivamente la salida: el faltante temporal permanece visible.
- La fecha del ticket/pago y el instante real de llegada a Bodega son independientes. La hora puede corregirse desde el detalle de la compra sin cambiar su pago, con bitácora. Se rechaza una hora posterior a una venta ya costeada o un traslado conocido de esa compra. No se recostean ventas históricas automáticamente.
- Las compras históricas sin hora mantienen referencia de día, no una hora inventada. Las del día de un conteo quedan señaladas: actualmente #104 y #105. La hora impresa en un ticket no acredita por sí sola la llegada al local. Los rebases del libro FIFO capturados tarde tampoco se convierten en compras físicas nuevas; este control evita inflar Squirt en 1,810 ml.
- Las transferencias existentes respetan ambos cortes; las nuevas pueden conservar hora efectiva y se bloquean cronologías imposibles. Siguen siendo movimientos de lote completo: la reposición parcial permanece como mejora posterior.
- El costeo de una venta importada tarde elige la versión de receta vigente en su fecha civil de México, no la última versión actual. El FIFO con hora conocida no toma compras recibidas después de la venta. La valoración histórica del conteo usa el costo vigente en el corte de cada zona.
- Snapshot, líneas, vínculo semanal, valor y bitácora se guardan atómicamente. Dos guardados simultáneos de la misma continuación no producen dos conteos oficiales ni snapshots huérfanos. No se permite un nuevo conteo oficial en una semana cerrada.

Validación: 148 pruebas unitarias en 16 suites; integración de 11 escenarios sobre negocio QA aislado; migración y prueba desde una base vacía y desde un respaldo restaurado; flujo completo de compra en copia local; revisión de interfaz en 360/390/1440 px. GitHub Actions incorpora PostgreSQL y ejecuta la prueba de integración además de tipos, pruebas y compilación.

La comparación de la copia restaurada con producción conserva las cantidades de los 105 productos y el valor físico de **$30,254.83**. No se alteraron compras históricas, pagos, consumos, conteos ni cierres para lograrlo. La semana 44 sigue pendiente por decisión del propietario. El cálculo detecta consumos sin saldo físico suficiente en su momento en Mineral, Albahaca, Fresas, Mermelada de tocino, Michemix, Perejil y Romero; esto requiere evidencia, no agregar entradas ficticias.

Orden siguiente: (1) consumo/costeo por presentación para servicios con envases pequeños completos; (2) clave idempotente para captura/reintento sin folio ni foto; (3) liquidación bancaria, arqueos y diferencias físicas con el responsable. Antes de replicar a otro negocio, también hay que alinear las restricciones legadas globales de nombre de producto/proveedor con la unicidad por negocio declarada en el esquema: la instalación desde migraciones aún conserva índices globales. No se modificaron esos índices de producción como efecto secundario de esta entrega.
