# Ibérico: operar inventario sin arrastrar diferencias

Implementación del 3 de noviembre de 2026. El cierre físico y el financiero son acciones distintas. Un banco pendiente no impide preparar la siguiente apertura de inventario.

## Recorrido diario

1. En Abasto → Compras captura el ticket, su pago y la hora real de llegada. Confirmar recibe una vez en Bodega, crea sus lotes y registra un solo pago. El borrador no es una entrada.
2. Lee el tamaño real del envase. Para mezcladores no se copia automáticamente el tamaño del catálogo. Un paquete de seis no es una botella. Coca se cuenta por pieza, pero el envase individual puede documentarse en ml sin multiplicar las piezas por 450.
3. Importa Epos. Se consumen las cantidades de la receta vigente para la fecha real de la venta. Los lotes elegibles más antiguos se usan primero. Una venta a precio cero también puede consumir inventario.
4. Si falta un ingrediente, los demás consumos no desaparecen. Se asigna lo disponible, el costo queda parcial y el reintento sólo completa lo pendiente. No se inventa una compra para tapar un faltante.
5. Para salidas no capturadas en Epos usa Operación → Salida o producción, o Abasto → Existencia actual → Registrar merma, cortesía o producción. Indica fecha real, zona, cantidad base, motivo y responsable. No registra otro gasto de Caja.
6. Producción consume ingredientes y crea un lote del producto obtenido con ese costo. Una operación tiene un producto obtenido; varias salidas pueden ser sus ingredientes. Ejemplo: tres lotes de mermelada de 400 g producen 1,200 g.

## Cierre de inventario

7. Guarda el físico por zona con su hora real. Puedes continuar Bodega y Local sin perder el primer corte. Una cantidad vacía no equivale a cero. El formulario distingue cantidades omitidas y permite completarlas conservando el original.
8. En Finanzas → Cierre, o Abasto → Existencia actual → Cierre y siguiente apertura, revisa esperado y físico al mismo corte. El cierre del domingo se proyecta hasta el fin de la semana con las recepciones y ventas posteriores al conteo. Las ventas anteriores, aunque se importen tarde, no vuelven a descontarlo.
9. Confirma “Conciliar y preparar siguiente apertura”. Se ajustan las capas mediante movimientos auditados y se generan capas sucesoras con costo, edad y linaje conservados. La apertura siguiente contiene el físico conciliado; no vuelve a cargar la diferencia anterior. El conteo original y los consumos históricos no se borran. Los sobrantes de origen desconocido quedan con costo estimado, no como compras ni productos gratuitos confirmados.
10. Explica las diferencias en el mismo lugar: causa, responsable, evidencia y estado. Clasificarlas no descuenta una segunda vez. Se separa la brecha existente antes del periodo de su diferencia semanal. Nunca se etiqueta automáticamente como robo o merma demostrada. Se priorizan por valor, sin compensar faltantes con sobrantes.
11. Revisa las alertas de repetición: mismo producto, signo y causa en al menos dos de los últimos cuatro cierres. Incluyen mermas/cortesías registradas y diferencias residuales sin duplicarlas. Es una señal para investigar, no una tolerancia del negocio. Presentaciones, horas o ventas históricas incompletas generan advertencias de calidad distintas de las pérdidas.

El cierre financiero congela saldos y comisiones. Si quedan costos pendientes puede confirmarse expresamente como provisional; no hace que esos costos sean cero. En esta entrega no se confirma el saldo pendiente de Banco ni se cierra financieramente la semana 44.

## Controles de seguridad

- Compra, pago y lotes en transacción; identificador de reintento para no duplicar una captura sin folio. Confirmar el mismo ticket de nuevo no crea otro pago.
- Cierre, compra, traslado, receta e importación comparten el bloqueo del libro. La confirmación comprueba que el conteo y la revisión no cambiaron. Dos cierres simultáneos generan una sola apertura.
- El corte conciliado no se reescribe con compras, traslados o correcciones retroactivas. Documenta el hallazgo y una corrección actual con evidencia; una importación histórica queda advertida y no reduce de nuevo la apertura.
- Una inconsistencia estructural (hora imposible, producto ajeno, saldo negativo o consumos posteriores incompatibles) sí requiere corregir datos. Una diferencia física válida no bloquea la continuidad.
- Servicios: las marcas de tequila y Bacardí permanecen separadas. Cinco minerales de 600 ml no se sustituyen por 3 L de formato distinto; dos Coca de 450 ml tampoco por dos botellas de 2 L. Los preparados en ml pueden usar formatos diferentes correctamente capturados. Los costos de referencia de servicios se obtienen de la presentación documentada, no del precio de un litro genérico.
- El resultado descuenta una vez las salidas sin venta y faltantes semanales. Producción capitaliza su costo; clasificaciones de Epos no duplican su costo de ventas. Brechas anteriores se muestran aparte y no se cargan como merma nueva. Todo costo incompleto permanece provisional.

## Verificación reproducible

`npm run typecheck -w client`, `npm test`, `npm run build`.

En una base PostgreSQL local cuyo nombre incluya `test`:

```
npx tsx server/scripts/verificar-cronologia-zonas.ts
npx tsx server/scripts/verificar-ciclo-inventario.ts
npx tsx server/scripts/verificar-trazabilidad-cierre.ts
```

La integración crea negocios QA aislados y se niega a escribir en una base remota. CI ejecuta estos recorridos además de las pruebas unitarias. `verificar-entrega-copia.ts` requiere una restauración local de producción, comprueba los 105 productos y verifica huellas de ventas, movimientos, arqueos y conteo original. `configurar-envases-servicios.ts` es simulación por defecto; el modo de aplicación es explícito y audita evidencia de presentación, sin cambiar cantidades o dinero.

## Límites honestos

Desde el 4 de noviembre, Abasto, Finanzas y la tarjeta de Operación muestran como importe principal la valoración FIFO: cantidad de cada capa por su costo almacenado, sumada antes de redondear. Catálogo aparece sólo como referencia secundaria. La valoración al corte comparte un único cálculo temporal; no se sustituye un costo casi igual por el precio de catálogo. Las capas con costo estimado se indican con su número y valor, incluso si alguna tiene costo técnico cero. Si las cantidades físicas y FIFO difieren, se advierte aparte: una diferencia de precios nunca se presenta como merma. Los cierres legados valorados con otro criterio conservan su registro histórico identificado; no se reescriben.

El software no demuestra por sí mismo que una diferencia sea derrame, regalo, receta incorrecta o mal conteo. Hace falta evidencia humana. Las horas históricas desconocidas no se convierten en horas observadas: se declara el límite legado y su resultado provisional. FIFO es una valoración teórica; el físico de cada zona sigue siendo la referencia de existencias. Los costos, saldos bancarios y causas pendientes no se certifican sólo porque la pantalla ya permita continuar.
