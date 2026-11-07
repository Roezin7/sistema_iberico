# Sistema Ibérico (NODO)

Back-office web instalable para operar uno o más negocios desde computadora, tablet o
móvil. Integra inventario, compras sugeridas, finanzas semanales, patrimonio, tareas,
usuarios y asistencia opcional con IA.

La implementación actual está preparada para **Ibérico**, con interfaz en español,
moneda MXN y zona horaria `America/Mexico_City`. El backend separa los datos por negocio,
aunque la selección dinámica del negocio todavía no está expuesta en la interfaz.

## Estado y prioridades actuales

La [auditoría integral del 6 de noviembre](docs/AUDITORIA_INTEGRAL_2026-11-06.md) documenta las correcciones de unidades, compras, cortes, costos y permisos, las pruebas realizadas y los pendientes reales.

La [corrección FIFO del 7 de noviembre](docs/FIX_FIFO_DECIMALES_2026-11-07.md) elimina el falso conflicto de cantidades decimales y distingue guardado exitoso de costeo posterior pendiente.

La revisión de producción del 3 de noviembre está en [Revisión ejecutiva y plan de Ibérico](docs/REVISION_EJECUTIVA_Y_PLAN_IBERICO_2026-11-03.md). Describe lo comprobado, las limitaciones de datos y el plan de cuatro semanas. La app se organiza en Operación, Abasto, Finanzas y Administración.

La arquitectura tiene separación por negocio, pero aún requiere adaptar marca, reglas, conexión Epos y selección de negocio para replicarla. No se presenta un porcentaje de reutilización sin un ensayo de réplica.

### Qué se reutiliza directamente

- Autenticación con PIN, JWT, roles `admin` y `empleado`, y administración de usuarios.
- Aislamiento de datos por `negocio_id` en los módulos operativos.
- Catálogos configurables de productos, categorías, tiendas, zonas y unidades de captura.
- Conteos, existencias, valorización y lista de compras.
- Motor financiero semanal, movimientos, saldos, arqueos, cuadre y cierres.
- Cálculo y seguimiento de patrimonio.
- Checklists diarios de apertura y cierre.
- PWA, navegación adaptable, modo claro/oscuro y cola de escrituras sin conexión.
- API Express, esquema Prisma/PostgreSQL, migraciones, Docker y despliegue como servicio único.
- Infraestructura de IA opcional y patrón de borrador con confirmación humana.
- Componentes transversales: cliente HTTP, exportación CSV, confirmaciones, prompts,
  notificaciones, estados de carga, iconos y manejo centralizado de errores.

### Qué debe adaptarse para otro negocio

- Marca NODO/Ibérico, textos y datos iniciales del `seed`.
- Moneda, locale y zona horaria visibles.
- Selección de negocio: el backend es multi-negocio, pero el login y la cabecera actuales
  operan con Ibérico/negocio inicial.
- Reglas financieras particulares, especialmente la comisión fija de terminal de **1.99%**,
  tipos de movimiento y definición de utilidad.
- Catálogos, niveles objetivo, costos, ubicaciones, socios y checklists.
- Prompt, personalidad y proveedor/modelo de Silvia.

Para convertirlo en un producto reutilizable sin tocar código, las prioridades son:
resolver el negocio por subdominio o selector, mover marca/moneda/zona horaria/comisiones a
configuración, crear un onboarding genérico y ampliar pruebas de API y flujos completos.

## Capacidades reales

### Acceso, usuarios y permisos

- Login visual por usuario y PIN; los PIN se almacenan con hash `bcrypt`.
- Sesión mediante JWT y consulta del usuario autenticado.
- Cambio de PIN propio.
- Alta, edición, activación/desactivación y restablecimiento de PIN por un administrador.
- Protección para no dejar al negocio sin ningún administrador activo.
- El empleado accede a Inicio, Inventario y Tareas.
- Finanzas, Patrimonio, Configuración y Silvia están protegidos para administrador tanto
  en la interfaz como en el backend.
- Rate limit general y límite más estricto contra intentos repetidos de login.

### Inventario

- Productos activos/inactivos con categoría, tienda de compra, nivel objetivo y costo unitario.
- Zonas de conteo configurables.
- Unidad y factor de conversión por producto y zona; admite unidades, cajas, fracciones y
  otras presentaciones convertidas a una unidad base.
- Conteos por zona almacenados como snapshots históricos.
- Existencia consolidada por producto y valor total del inventario.
- Faltante contra el nivel objetivo.
- Lista de compras agrupada por tienda, con subtotales y total estimado.
- Categorías para agrupar el conteo.
- Alias de producto para mejorar el reconocimiento por IA.
- Borrador de conteo desde texto o imagen. La propuesta es editable y sólo se guarda
  cuando el usuario la confirma.

### Finanzas

- Semanas operativas consecutivas con estados abierta/cerrada.
- Captura diaria de venta en efectivo, venta con tarjeta, propina con tarjeta, gasto en
  efectivo y sueldos.
- Movimientos adicionales: comisión de terminal, compra de inventario, transferencia,
  retiro de socio, depósito y propina pagada.
- Movimientos asociados a fecha, usuario, origen/destino, categoría, socio y estado de
  facturación según corresponda.
- Cálculo automático de comisión de terminal al **1.99%** sobre tarjeta más propina de tarjeta.
- Saldos iniciales por ubicación y encadenamiento de saldos entre semanas.
- Arqueos por ubicación, saldo teórico, saldo real y detección de faltante o sobrante.
- Resumen semanal de ventas, utilidad, margen, compras, gastos, sueldos, comisión y capital
  por socio.
- Cierre de semana con validaciones y saldos congelados.
- Reapertura de semanas cerradas y edición de su operación.
- Configuración de ubicaciones de fondos (banco/efectivo), categorías de gasto y socios.
- Exportación CSV de movimientos.

### Patrimonio

- Snapshot automático al cerrar una semana.
- Suma de banco, efectivo e inventario como activos.
- Registro, edición y activación/desactivación de pasivos.
- Patrimonio neto calculado como activos menos pasivos.
- Historial y tendencia entre snapshots.
- Exportación CSV.

### Tareas

- Checklists configurables de apertura y cierre.
- Alta, edición, orden, activación y eliminación de checklists e ítems.
- Instancia diaria automática por checklist.
- Marcado y desmarcado de cada tarea por administradores o empleados.
- Registro del usuario y momento de terminación.

### Configuración

- Nombre del negocio desde la interfaz; el tipo también existe y puede editarse mediante API.
- Consulta de la zona horaria configurada (actualmente fija en la interfaz).
- Usuarios, roles, estado y PIN.
- Productos, costos, mínimos, categorías, tiendas, zonas y unidades/factores de captura.
- Saldos iniciales y ubicaciones de fondos.
- Categorías de gasto y socios.
- Checklists e ítems de apertura/cierre.

### Silvia, coach opcional con IA

- Chat flotante exclusivo para administradores.
- Contexto de KPIs reales: ventas, utilidad, margen, comisión, patrimonio e inventario.
- Consulta detallada del inventario en tiempo real.
- Historial persistente de conversación.
- Memoria separada en eventos, notas y aprendizajes; permite registrar y eliminar recuerdos.
- La IA sólo escribe en sus tablas de conversación/memoria. No modifica inventario,
  finanzas, patrimonio ni tareas.
- Se oculta y sus endpoints de operación no están disponibles si falta
  `ANTHROPIC_API_KEY`.

Silvia y el borrador de inventario usan Anthropic. Son funciones opcionales: el resto del
sistema opera sin una llave de IA.

### PWA y operación sin conexión

- Aplicación instalable con manifest, iconos y service worker de actualización automática.
- Diseño adaptable con navegación lateral o inferior y temas claro/oscuro.
- El shell de la aplicación queda disponible sin conexión.
- Sólo los borradores de compra y los resultados de tareas admiten cola sin conexión.
  Pagos, conteos y cierres requieren conexión. La captura de compras conserva además
  un borrador local con foto y datos al recargar.
- Indicador de conexión y cantidad de operaciones pendientes.
- Los rechazos `4xx` se retiran de la cola y se muestran al usuario; los errores
  transitorios de red/servidor se conservan para reintento.
- Las lecturas de API no se cachean: requieren conexión.

### Seguridad y operación técnica

- Validación de entradas con Zod.
- Separación por negocio obtenida del JWT en las consultas operativas.
- Helmet y Content Security Policy en producción.
- CORS cerrado al mismo origen por defecto y configurable por lista de orígenes.
- Límite JSON de 10 MB para imágenes de conteo asistido.
- Compresión de respuestas y caché prolongada para assets versionados.
- `/api/health` comprueba tanto el servicio como la conexión real a PostgreSQL.
- Migraciones Prisma y script de migración de datos históricos.

## Arquitectura

Monorepo npm con un despliegue de **un solo servicio**: Express expone la API bajo
`/api` y sirve la PWA compilada.

```text
/
├── client/                 React + TypeScript + Vite + PWA
│   └── src/
│       ├── screens/        módulos de interfaz
│       ├── ui/             componentes transversales
│       ├── api.ts          cliente HTTP
│       └── offline.ts      cola IndexedDB y sincronización
├── server/                 Express + TypeScript + Prisma + Zod
│   ├── prisma/             esquema, seed y migraciones
│   ├── scripts/            migración de datos históricos
│   └── src/                rutas, servicios y lógica de dominio
├── Dockerfile              imagen API + PWA
├── render.yaml             despliegue alternativo en Render
└── DEPLOY.md               guía de Coolify/Hetzner
```

### Stack

- Node.js 20 o superior.
- React 18, React Router, Vite y `vite-plugin-pwa`.
- Express, Prisma ORM y PostgreSQL.
- TypeScript en cliente y servidor.
- Zod, JWT, bcrypt, Helmet, CORS y rate limiting.
- IndexedDB mediante `idb`.
- Vitest para reglas puras de inventario, finanzas y patrimonio.
- Anthropic SDK para las capacidades opcionales de IA.

## Puesta en marcha

### Requisitos

- Node.js 20+
- npm
- PostgreSQL accesible mediante `DATABASE_URL`

### Desarrollo

1. Crea el archivo de entorno en la raíz:

   ```bash
   cp server/.env.example .env
   ```

2. Configura al menos `DATABASE_URL` y un `JWT_SECRET` de 16 caracteres o más. La
   variable `ANTHROPIC_API_KEY` es opcional.

3. Instala, genera el cliente de Prisma y aplica las migraciones:

   ```bash
   npm install
   npm run prisma:generate
   npm run prisma:migrate
   ```

4. Carga los datos iniciales. Para evitar el PIN predeterminado, define uno al ejecutar:

   ```bash
   SEED_ADMIN_PIN=un-pin-seguro npm run seed
   ```

5. Inicia API y cliente:

   ```bash
   npm run dev
   ```

La API corre en `http://localhost:3000` y Vite en `http://localhost:5173`, con proxy de
`/api` hacia el servidor.

### Producción local

```bash
npm run build
npm start
```

El servicio completo queda en el puerto configurado por `PORT` (3000 por defecto).

### Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Cliente y servidor con recarga en desarrollo |
| `npm run build` | Compila la PWA y el servidor |
| `npm start` | Sirve API y PWA compilada |
| `npm test` | Ejecuta pruebas del servidor y cliente |
| `npm run seed` | Crea el negocio y datos iniciales de Ibérico |
| `npm run prisma:generate` | Genera Prisma Client |
| `npm run prisma:migrate` | Crea/aplica migraciones de desarrollo |
| `npm run prisma:studio` | Abre Prisma Studio |
| `npm run prisma:introspect` | Importa el esquema de una base existente |
| `npm run migrar:historico -w server` | Ejecuta la migración histórica incluida |

## Variables de entorno

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Conexión PostgreSQL |
| `JWT_SECRET` | Sí | Firma de tokens; mínimo 16 caracteres |
| `PORT` | No | Puerto HTTP; predeterminado `3000` |
| `NODE_ENV` | No | `development`, `production` o `test` |
| `ANTHROPIC_API_KEY` | No | Activa Silvia y el borrador de conteo con IA |
| `ALLOWED_ORIGINS` | No | Orígenes CORS separados por coma; vacío conserva mismo origen |
| `SEED_ADMIN_PIN` | Sólo seed | PIN inicial de administradores; si se omite, el seed usa `1234` |

## Pruebas y límites conocidos

Las pruebas actuales cubren las reglas puras más sensibles:

- Conversión, faltantes, valoración y agrupación de compras de inventario.
- Comisión, saldos, cuadre, resumen y capital de socios en finanzas.
- Cálculo de patrimonio neto.

Límites que deben considerarse:

- Hay pruebas de contrato HTTP y cuatro verificaciones integrales en CI: cronología de zonas,
  ciclo FIFO, trazabilidad de cierre e integridad de aplicación. También se ejecutan contra
  una copia local restaurada. La revisión visual se documenta en el informe; todavía no está automatizada en CI.
- La experiencia visual selecciona el negocio inicial; no existe selector o resolución por
  subdominio.
- La autenticación por PIN es adecuada para operación interna, no sustituye SSO/MFA.
- La cola offline conserva escrituras, pero no ofrece resolución automática de conflictos.
- Las lecturas y datos previos no están disponibles offline.
- El proveedor de IA es Anthropic y el modelo configurado en código puede requerir
  actualización conforme cambie su disponibilidad.
- `ingests` pertenece al sistema histórico de Telegram y no participa en la aplicación actual.

## Despliegue

El `Dockerfile` genera la PWA, compila el servidor, aplica `prisma migrate deploy` al
arrancar y expone un healthcheck. La guía de despliegue en Coolify/Hetzner y migración de
datos está en [DEPLOY.md](DEPLOY.md). También se incluye `render.yaml` para Render.
