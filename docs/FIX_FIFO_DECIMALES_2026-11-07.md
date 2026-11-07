# Corrección FIFO y revisión de ventas — 7 de noviembre de 2026

## Causa reproducida

El cierre del viernes 6 guardó 27 líneas Epos por $3,230 en la importación 36.
Después falló el costeo con HTTP 409. El error escapaba hasta la pantalla y evitaba
mostrar el corte revisable, aunque las ventas ya estaban persistidas.

En una copia local de producción se reprodujo el fallo: lote de Limón 1385 con
saldo NUMERIC `0.5600`; el parámetro JavaScript `0.56` llegaba como float8 y al
convertirlo a NUMERIC PostgreSQL comparaba contra `0.5600000000000001`.
La protección contra sobregiro rechazaba la actualización. No era concurrencia real.

## Corrección

- Parámetros SQL de cantidades y costos enviados como **texto decimal exacto**,
  usando la escala del libro. También se serializan los consumos con esa precisión.
- Se mantiene el rechazo de saldo insuficiente, sin tolerancias, recortes silenciosos
  ni inventario artificial. Una solicitud de 0.5602 contra 0.56 sigue generando faltante.
- Importar ventas y confirmar compras conservan su resultado cuando ya hubo COMMIT.
  Un fallo posterior de costeo/mapeo devuelve una advertencia explícita y costo pendiente,
  no un error que sugiera repetir venta, lote o pago. Un fallo al persistir sí sigue siendo error.
- La revisión diaria conserva importes, detalle y confirmación del corte aun con esa advertencia.
  Las compras muestran “Compra y pago confirmados” y propagan la advertencia al listado.
- No se confirma automáticamente un corte financiero ni se inventan propinas o sueldos.

## Verificación

- 273 pruebas automatizadas (232 servidor, 41 cliente), typecheck y compilación de producción.
- Regresión con PostgreSQL real: agotar exactamente 0.56; conservar faltante real;
  reintentar sin doble consumo; compra/pago únicos si falla el recosteo posterior.
- Cuatro suites integrales previas de cronología, ciclo, trazabilidad e integridad pasan.
- Caso real restaurado: el mismo costeo que antes fallaba ahora procesa 25 líneas;
  dos quedan con faltantes reales de Mermelada de tocino y Perejil. No se completan con datos supuestos.
- Pruebas de importación simulan fallos de costeo y mapeo tras guardar, y un fallo de
  persistencia: sólo los dos primeros permiten continuar con advertencia.
- QA visual de revisión con advertencia en móvil/escritorio, sin confirmar dinero ni
  enviar una importación real desde la prueba simulada.

Nueva regresión incorporada a CI:

```sh
npm test
npm run typecheck -w client
npm run build
# DATABASE_URL debe apuntar a DB LOCAL con test/audit en el nombre:
npx tsx server/scripts/verificar-decimales-fifo.ts
```

La publicación requiere respaldo y comparación de compras, movimientos, arqueos y conteos.
Al recuperar ventas pendientes, sólo deben cambiar el costeo y sus consumos; los métodos
financieros siguen pendientes de confirmación humana. Repetir no debe duplicar consumos.
