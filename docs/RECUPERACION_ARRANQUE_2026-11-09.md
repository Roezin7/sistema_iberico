# Recuperación del inicio y navegación de Abasto

## Hallazgo

En producción, un archivo retirado como `/assets/index-CigPwVFt.js` respondía
HTTP 200 con `text/html`: el fallback de la SPA ocultaba el archivo inexistente.
Una copia anterior del HTML podía pedir ese módulo y no llegar a montar React.
El botón de arranque sólo navegaba a `/`, sin recuperar el código precacheado.
En una sesión limpia la aplicación sí cargaba: no se atribuye el incidente a
corrupción del inventario o a una caída permanente de la API.

## Corrección

- Los assets inexistentes devuelven 404 de texto, nunca HTML con 200.
- HTML, service worker, registro y versión llevan `no-store`; los assets con
  hash mantienen caché inmutable.
- El HTML incorpora recuperación independiente del bundle ante error de módulo
  o 15 segundos sin montar. Hay un único intento automático en cinco minutos,
  con respaldo en la URL si `sessionStorage` no está disponible.
- Se libera únicamente el service worker `/sw.js` y el precache Workbox de la
  misma aplicación. No se borran IndexedDB, sesión, token ni caches ajenas.
- Las operaciones de limpieza tienen un límite de dos segundos. Sin conexión
  se muestra una explicación; hay reintento manual y al volver la conexión.
- Se conserva la ruta, parámetros de semana/cierre y fragmento. El parámetro
  interno se retira al montar. No se recarga automáticamente una captura ya
  montada por errores posteriores.
- Google Fonts carga sin bloquear el arranque.
- El error de React también ofrece la recuperación explícita de código.

## Verificación

- 313 pruebas automáticas, typecheck y build de producción.
- Navegador móvil y escritorio: fallo transitorio se recupera una vez; fallo
  persistente no hace bucle y admite reintento manual; fuentes bloqueadas no
  impiden cargar.
- Service worker real con HTML precacheado apuntando a un módulo retirado:
  recupera la aplicación y conserva un pendiente de prueba en IndexedDB y una
  caché ajena. Sólo se usan datos sintéticos en un perfil aislado.
- Navegación Conteo ↔ Existencia actual ↔ Compras, Atrás/Adelante y contexto de
  semana comprobados también en producción. No se hicieron escrituras de negocio.
