# Auditoría integral de Ibérico — 6 de noviembre de 2026

## Resultado ejecutivo

Se revisaron inventario, apertura/cierre por zona y hora, compras/pagos, recetas/costos,
ventas Epos, conciliación financiera, tareas, patrimonio, permisos y trabajo sin conexión.
Las correcciones protegen la interpretación de los datos y evitan falsas confirmaciones;
no crean pantallas ni reescriben existencias, compras o ventas históricas de producción.
No es una certificación de ausencia de errores: las pruebas delimitan lo verificado y los
pendientes de datos, seguridad y operación permanecen explícitos.

## El caso de las dos botellas de 1800

No faltaba una entrada ni hay que duplicarla. Producto 19, botella de 700 ml:

| Momento / fuente | Local | Bodega | Total |
| --- | ---: | ---: | ---: |
| Apertura oficial del 2 de noviembre, snapshot 115 | 0.3 | 0 | 0.3 |
| Compra 107, La Comer, 4 de noviembre, lote 1477 | — | +2 | +2 |
| Existencia actual verificada | 0.3 | 2 | 2.3 |

La compra recibió 1,400 ml; sumados a los 210 ml iniciales son 1,610 ml.
El campo de la captura mostraba correctamente la apertura, pero podía interpretarse como
saldo actual. Ahora la pantalla distingue **conteo guardado** de **existencia actual**,
identifica la zona capturada y muestra el total/zonas cuando difiere del histórico.
Las compras entran a Bodega; la apertura ya guardada no se modifica retroactivamente.

## Hallazgos y solución aplicada

| Riesgo comprobado | Corrección |
| --- | --- |
| kg/ml explícitos podían multiplicarse por el contenido comercial | Conversor compartido entre cliente y servidor: primero dimensión métrica. 0.3 kg = 300 g aunque la pieza del catálogo sea de 150 g. No acepta kg contra ml. |
| Factores de captura históricos confundidos con presentación vigente | Se mantiene el factor original para interpretar el saldo; se convierte a la unidad de captura visible. Etiqueta, precarga, esperado y envío usan una misma regla. |
| Cambiar la unidad base podía reinterpretar todos los registros anteriores | Se bloquea cambiarla si ya tiene compras, lotes, conteos, recetas o conversiones. Requiere una migración explícita, no un PATCH informal. |
| Envases de mezcladores asumidos por catálogo | Continúa presentación por lote: tamaño observado obligatorio cuando se cuentan envases. Si ya se ingresa kg/l, no se solicita un multiplicador comercial. |
| PUT parcial del día convertía campos omitidos en cero | Los cinco importes diarios son obligatorios y finitos. Se rechaza el parcial sin borrar ventas. |
| Corte Epos y dinero podían guardarse por separado | Una transacción confirma ambos; una falla revierte ambos. Se valida suma y correspondencia efectivo/tarjeta/otros. |
| Cash/Card sólo permitía escoger todo a un método | Reparto explícito efectivo/tarjeta que debe cuadrar. Se documenta como reparto diario; no inventa desglose individual de ventas. Métodos desconocidos no se confirman como conocidos. |
| Mismo total con métodos diferentes se marcaba conciliado | El estado compara también efectivo, tarjeta y otros. |
| Edición financiera podía cambiar facturación implícitamente | Se conserva la marca anterior salvo cambio explícito. |
| Transferencias/fondos/categorías podían tener referencias ambiguas | Mismo negocio y cuentas activas, origen distinto al destino, campos compatibles con el tipo, socio correspondiente a caja fuerte; validación también al editar. |
| Arqueos en semanas cerradas, o null convertido en cero | Se rechazan; cero debe ser una cifra explícita. Escrituras financieras y cierre usan bloqueo común y revalidación de estado. |
| Fechas inexistentes normalizadas por JavaScript | Validación de fecha civil real y predeterminado México; 30 de febrero se rechaza. |
| Promedios de menú, tarjetas y desglose mezclaban fuentes de costo | Una selección común: FIFO disponible, referencia documentada, catálogo o pendiente. Indicadores y desglose usan la misma fuente. |
| Recetas futuras influían en costo actual; validación podía aceptar unidades incompatibles | Se respeta vigencia y se comprueban ingredientes activos, dimensiones, duplicados y envases enteros. ID Epos no se duplica entre artículos activos. |
| Salidas sin venta podían descontarse dos veces en P&L por inventario | Apertura + compras − cierre ya contiene la salida: no se resta otra vez. Método FIFO la descuenta una vez; costo nulo sigue pendiente. |
| Cambio rápido de semana/fecha podía mostrar formularios de otra selección | Aislamiento por semana y descarte de respuestas obsoletas; se bloquea captura mientras carga. |
| Error de red podía parecer cero, carga infinita o estado verde | Lecturas operativas clave muestran error/reintento. Una respuesta no JSON no equivale a guardado exitoso. |
| Token conservaba permisos tras desactivar usuario/cambiar rol | Se verifica usuario/negocio/rol en cada petición; sesión anterior deja de autorizar. Se protege último administrador con bloqueo transaccional. |
| Cola offline podía reproducir una sesión ajena o acciones financieras antiguas | Lista permitida de acciones, misma identidad/negocio, token vigente; las incompatibles se conservan para revisión, no se ejecutan ni descartan silenciosamente. |
| Tareas de eventos entre semana ocultas | Operación especial se reconoce por ventas/instancias o activación explícita de administrador; comprar para preparar no activa un día de bar. |
| Presentación de patrimonio y fiscalidad más concluyente que sus datos | Patrimonio indica último cierre. Marcas de facturación no afirman recepción/validez de CFDI. |
| Marketing podía parecer publicador/sincronizador | Se identifica como planeador manual local del navegador, sin publicación automática ni sincronización. |
| Filtros Productos y campos Marketing desbordaban en móvil | Columnas y mínimos de ancho corregidos sin ocultar información ni agregar navegación. |

## Evidencia de verificación

- Producción, consultas en transacción de sólo lectura: 108 productos, 102 registros de
  menú, 1,277 líneas de venta, 1,269 lotes, 6,779 consumos, 91 snapshots.
- Cero consumos duplicados por venta/producto/lote, lotes con saldo fuera de rango,
  referencias cruzadas entre negocios revisadas, ID Epos duplicados en menú activo,
  tickets confirmados descuadrados contra líneas o sumas internas de métodos incoherentes.
- **254 pruebas automatizadas**: 213 servidor y 41 cliente; typecheck y build de producción.
- **35 grupos de escenarios integrales** en cuatro scripts: cronología de zonas (11),
  ciclo FIFO (12), trazabilidad de cierre (3), integridad de aplicación (9).
  Ejecutados sobre copia local restaurada; los de integridad comparan huellas de datos
  reales antes/después y sólo escriben negocios sintéticos. También se verifica el flujo
  de CI desde una base nueva con las migraciones del repositorio.
- Navegador: **15 vistas × móvil oscuro / escritorio claro**, sin errores JavaScript,
  respuestas 5xx inesperadas ni desborde de documento. Error de Operación simulado para
  comprobar que no se muestra “Operación en orden” con datos ausentes.
- Conteos: **3,344 campos**, apertura/cierre de dos semanas, Local/Bodega, dos temas,
  móvil/escritorio. Cuatro guardados interceptados verificaron kg→g sin escribir al servidor.
- Caso real 1800: apertura 0.3/0 intacta, actual 0.3/2, total 2.3.
- Caso compra en navegador: 0.3 kg Manzana → 300 g, sin multiplicador de envase.
- Respaldo privado previo a publicar y comparación de huellas en siete tablas operativas.
  No hay migración de esquema ni reparación masiva de cantidades en esta entrega.

Comandos reproducibles (las integrales exigen URL **local** cuyo nombre contenga test/audit):

```sh
npm run typecheck -w client
npm test
npm run build
npx -w server prisma migrate deploy
npx tsx server/scripts/verificar-cronologia-zonas.ts
npx tsx server/scripts/verificar-ciclo-inventario.ts
npx tsx server/scripts/verificar-trazabilidad-cierre.ts
npx tsx server/scripts/verificar-integridad-aplicacion.ts
```

Auditoría de producción: `scripts/auditar-produccion-readonly.sql`.
Comparación antes/después: `scripts/huellas-datos-operativos.sql` (negocio 1, sin datos personales).
La inspección visual se ejecutó con Playwright fuera del repositorio; todavía no está
integrada en CI. No sustituye pruebas con dispositivos físicos ni una auditoría de penetración.

## Seguridad: corrección inmediata y deuda explícita

Se actualizaron versiones compatibles de Express, body-parser, proxy-addr, compression,
qs, express-rate-limit/ip-address y React Router 6. El audit de dependencias de producción
pasó de 11 avisos (uno crítico) a **6 avisos: cuatro altos y dos moderados, cero críticos**.
Son conteos de paquetes afectados, no seis ataques demostrados ni seis causas independientes.

Pendientes: Zod 4.6.6+, actualización compatible de Prisma/config/deepmerge-ts y Router 7.18+.
No se ejecutó `npm audit fix --force`: sus saltos mayores necesitan revisión de contratos.
Como mitigación de Zod se limita profundidad, elementos y nodos JSON antes de validar,
además del límite de bytes y rate limit. **La mitigación no elimina el aviso ni sustituye
la actualización.** El caso deepmerge requiere objetos cíclicos; JSON HTTP no genera
ciclos por sí mismo, pero debe revisarse cualquier entrada futura a esa dependencia.
Referencias: [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[compression](https://github.com/expressjs/compression/security/advisories/GHSA-vc2v-76pw-4v95),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[deepmerge-ts](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).

## Pendientes reales y plan corto

1. **Antes del siguiente cierre:** resolver cinco excepciones sin inventar evidencia:
   Pizza Catalana (faltan 40 g de Mermelada de tocino; costo parcial), dos ventas de
   Cuba de San Matías y dos de Shot Bacardi sin receta/mapeo verificado. Confirmar
   porciones exactas y correspondencia Epos; reintentar sólo el faltante.
2. **Esta semana:** registrar llegada real, presentación del lote y zona; contar cada zona
   a su hora y revisar alertas de diferencia. Comparar merma por causa/recurrencia, no
   forzar a cero ni generar compras ficticias. El esperado no sustituye conteo físico.
3. **Siguiente iteración técnica:** migrar dependencias pendientes en rama de pruebas,
   sin modificar reglas del negocio; repetir suites/CI y comparación de datos. Añadir QA
   visual repetible a CI y verificación con teléfono físico.
4. **Siguiente iteración operativa:** unificar definición de factura solicitada/recibida/CFDI
   y marca financiera, con migración revisada; no transformar marcas históricas por inferencia.
5. **Después, según uso real:** respaldar/sincronizar Marketing si se necesita multiusuario;
   por ahora sigue explícitamente local. Antes de replicar a otro negocio, hacer piloto con
   calendario, moneda, zona horaria, marca y Epos propios; varias reglas siguen siendo de Ibérico.

No se cambian mínimos ni recetas inciertas para “limpiar” alertas. Una interfaz más clara
ayuda, pero la fiabilidad requiere evidencia de compras, dosis y conteos verificables.
