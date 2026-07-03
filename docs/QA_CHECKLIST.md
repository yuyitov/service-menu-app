# QA Checklist — Service Menu App

## Phase 1 — Verificación del generador (local)

Pasos concretos para validar el generador estático de Phase 1:

- [ ] `python generator/generate_service_menu.py` corre sin errores y reporta
      "Generadas 6/6 paginas".
- [ ] Se crean `public/demos/{bella-spa,studio-blush,north-barber,glow-nails,`
      `aqua-wellness,sage-studio}/index.html`.
- [ ] Un payload al que le falta un campo requerido falla con mensaje claro y exit code
      distinto de 0 (no genera página incompleta).
- [ ] Un `brand_style` fuera de los 6 estilos cerrados es rechazado con mensaje claro.
- [ ] Los 6 estilos cerrados (`black-gold`, `soft-blush`, `charcoal-clean`, `warm-sand`,
      `aqua-clean`, `sage-calm`) renderizan y se distinguen visualmente (paleta/acento
      distinto por estilo; el `<body>` lleva la clase `style-<brand_style>`).
- [ ] En una demo sin `logo_url` / `primary_image_url`, aparece el placeholder visual
      (nunca una imagen rota).
- [ ] En una demo sin `featured_package` / `instagram` / `google_reviews_url`, esas
      secciones/botones se omiten limpiamente (sin huecos ni "undefined").
- [ ] Caracteres especiales (tildes, ñ, `&`, comillas, emoji) se ven bien y aparecen
      escapados en el HTML (`&amp;`, `&quot;`), sin romper la página.
- [ ] Se ve correctamente en viewport mobile (~375px).
- [ ] La sección "QR Kit" muestra el placeholder y el `public_url` al que apuntará.
- [ ] El link visible apunta al `public_url` del payload.
- [ ] No hay referencias a MyGuest ni secrets en `generator/`, `data/`, `public/`.

## Phase 2 — QR estático + GitHub Actions (local/CI)

- [ ] `python generator/generate_service_menu.py` genera, por cada demo, `index.html`
      **y** `qr.svg` en `public/demos/<slug>/`.
- [ ] Existen los 12 archivos esperados: `index.html` + `qr.svg` para las 6 demos
      (bella-spa, studio-blush, north-barber, glow-nails, aqua-wellness, sage-studio).
- [ ] Cada `qr.svg` es un SVG válido (empieza con `<svg`) y codifica el `public_url`
      de su demo (no localhost, sin tokens, sin parámetros de tracking).
- [ ] La sección "Comparte esta página" muestra el QR (`<img src="qr.svg">`), el link
      visible y el botón "Abrir página"; se ve bien en mobile y en los 6 estilos.
- [ ] El QR se ve escaneable sobre la caja blanca también en estilos oscuros (black-gold).
- [ ] No hay tokens `{{...}}` sin reemplazar en la salida.
- [ ] Si falta la dependencia `segno`, el generador falla con mensaje claro (instalar
      `requirements.txt`), no con un stack trace opaco.
- [ ] El workflow `.github/workflows/generate-demos.yml` corre en push/PR, genera las
      demos y valida assets/tokens/secrets/MyGuest **sin** publicar a GitHub Pages ni usar
      secrets.

## Generación de página dummy

- [ ] Se puede generar una página completa a partir de un `service_menu_payload_public`
      de ejemplo, sin depender de Stripe/Tally/Worker reales.
- [ ] La página generada renderiza correctamente todos los campos presentes.
- [ ] La página generada omite limpiamente los campos opcionales ausentes (sin mostrar
      secciones vacías o "undefined").

## Validación de campos requeridos

- [ ] `business_name`, `short_description`, `services`, `whatsapp`, `address`,
      `opening_hours_text`, `google_maps_url`, `public_slug`, `brand_style` presentes y
      no vacíos.
- [ ] Falla de forma clara (error legible) si falta un campo requerido, en vez de
      generar una página incompleta silenciosamente.
- [ ] `services[]` con al menos un servicio.

## Mobile responsive

- [ ] La página se ve correctamente en viewport mobile (375px de ancho aprox.).
- [ ] Botones de WhatsApp/Instagram/Maps son tocables cómodamente en mobile (tamaño de
      touch target adecuado).
- [ ] El QR es visible y legible también en la versión mobile si se muestra inline.

## Caracteres especiales

- [ ] Nombres de negocio y servicios con tildes, ñ, emojis no rompen el render.
- [ ] Comillas, ampersands (`&`) y otros caracteres HTML-sensibles se escapan
      correctamente (sin romper el HTML ni permitir inyección).

## Links

- [ ] Link de WhatsApp abre correctamente con el número y formato esperado
      (`https://wa.me/<numero>`).
- [ ] Link de Instagram (si presente) apunta al perfil correcto.
- [ ] Link de Google Maps abre la ubicación correcta.
- [ ] Link de Google Reviews (si presente) funciona y apunta al negocio correcto.

## QR

- [ ] El QR generado apunta exactamente al `public_url` de la página.
- [ ] El QR es descargable en un formato usable (PNG/SVG) y con resolución suficiente
      para impresión.
- [ ] El QR escanea correctamente desde un dispositivo real.

## Link visible

- [ ] El `public_url` es corto, legible y basado en el `public_slug` (sin IDs opacos
      innecesarios).
- [ ] El slug es único (sin colisiones entre negocios distintos).

## Email de entrega

- [ ] El email de entrega incluye `public_url`, el QR (adjunto o embebido) y el link de
      corrección.
- [ ] El email llega al `customer_email` correcto asociado al `order_id`.
- [ ] El asunto y contenido del email son claros sobre qué hacer a continuación.

## Correction link one-time

- [ ] El link de corrección funciona una primera vez.
- [ ] El mismo link, usado una segunda vez, es rechazado.
- [ ] Un `correction_token` inválido o de otro pedido es rechazado.
- [ ] Los cambios enviados vía corrección se reflejan correctamente en la página
      republicada.

## No tocar MyGuest

- [ ] Ningún archivo del repo de MyGuest fue modificado durante el trabajo en este
      proyecto.
- [ ] Ningún Worker, KV namespace, workflow o secret de MyGuest fue tocado.
- [ ] `git status`/diff en el repo de MyGuest (si aplica) no muestra cambios inesperados.

## No secrets en repo

- [ ] No hay archivos `.env`, credenciales ni claves API commiteadas en el repo de
      Service Menu App.
- [ ] `.gitignore` cubre archivos de configuración local con secrets antes de que exista
      alguno.

## Build limpio

- [ ] El proceso de generación de la página corre sin errores ni warnings inesperados.
- [ ] No quedan archivos temporales o de debug commiteados tras un build.

## Prueba end-to-end futura (cuando exista integración real)

- [ ] Flujo completo: pago dummy → intake dummy → generación → publicación → entrega →
      corrección, verificado de punta a punta en un entorno de pruebas.
- [ ] Verificar idempotencia: reenviar el mismo webhook de Stripe/Tally no duplica el
      pedido ni la página.
