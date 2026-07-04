# QA Checklist — Service Menu App

## Phase 1 — Verificación del generador (local)

Pasos concretos para validar el generador estático de Phase 1:

- [ ] `python generator/generate_service_menu.py` corre sin errores y reporta
      "Generadas 12/12 paginas".
- [ ] Se crean `public/demos/{bella-spa,studio-blush,north-barber,glow-nails,`
      `aqua-wellness,sage-studio,pulse-fitness,cafe-terra,pawsome-grooming,`
      `iron-ink-tattoo,clarity-coaching,horizon-tours}/index.html`.
- [ ] Un payload al que le falta un campo requerido falla con mensaje claro y exit code
      distinto de 0 (no genera página incompleta).
- [ ] Un `brand_style` fuera de los 12 estilos cerrados es rechazado con mensaje claro.
- [ ] Los 12 estilos cerrados (`black-gold`, `soft-blush`, `charcoal-clean`, `warm-sand`,
      `aqua-clean`, `sage-calm`, `electric-slate`, `terracotta-warm`, `sunny-paws`,
      `midnight-ink`, `clarity-editorial`, `horizon-teal`) renderizan y se distinguen
      visualmente (paleta/acento distinto por estilo; el `<body>` lleva la clase
      `style-<brand_style>`).
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
- [ ] Existen los 24 archivos esperados: `index.html` + `qr.svg` para las 12 demos
      (bella-spa, studio-blush, north-barber, glow-nails, aqua-wellness, sage-studio,
      pulse-fitness, cafe-terra, pawsome-grooming, iron-ink-tattoo, clarity-coaching,
      horizon-tours).
- [ ] Cada `qr.svg` es un SVG válido (empieza con `<svg`) y codifica el `public_url`
      de su demo (no localhost, sin tokens, sin parámetros de tracking).
- [ ] La sección "Comparte esta página" muestra el QR (`<img src="qr.svg">`), el link
      visible y el botón "Abrir página"; se ve bien en mobile y en los 12 estilos.
- [ ] El QR se ve escaneable sobre la caja blanca también en estilos oscuros (black-gold).
- [ ] No hay tokens `{{...}}` sin reemplazar en la salida.
- [ ] Si falta la dependencia `segno`, el generador falla con mensaje claro (instalar
      `requirements.txt`), no con un stack trace opaco.
- [ ] El workflow `.github/workflows/generate-demos.yml` corre en push/PR, genera las
      demos y valida assets/tokens/secrets/MyGuest **sin** publicar a GitHub Pages ni usar
      secrets.

## Phase 3B — Demos públicas en GitHub Pages

- [ ] GitHub Pages está habilitado en el repo `yuyitov/service-menu-app` con build
      "GitHub Actions" (no branch).
- [ ] El workflow `.github/workflows/pages.yml` corre en push a `main`, regenera las 12
      demos desde cero y repite las validaciones (outputs, tokens, secrets, MyGuest).
- [ ] `pages.yml` publica **solo** la carpeta `public/` y usa permisos mínimos
      (`contents: read`, `pages: write`, `id-token: write`), sin secrets configurados.
- [ ] Los 12 `public_url` de `data/demos/*.json` apuntan a
      `https://yuyitov.github.io/service-menu-app/demos/<slug>/` (no localhost, no
      dominio dummy, no dominio custom).
- [ ] Cada `qr.svg` regenerado codifica la URL pública real de su demo.
- [ ] Las 12 URLs públicas abren en navegador (HTTP 200) y muestran la página correcta.
- [ ] Al menos un `qr.svg` público responde HTTP 200 y es un SVG válido.
- [ ] `generate-demos.yml` sigue existiendo y pasando como workflow de validación.
- [ ] MyGuest no fue tocado; no hay Stripe/Tally/Worker/KV/emails implementados.

## Phase 4 — Landing comercial pública

- [ ] Existe `public/index.html` y abre en `https://yuyitov.github.io/service-menu-app/`.
- [ ] La landing usa solo el nombre provisional ("Service Pages" / "Service Menu App");
      no menciona MyGuest.
- [ ] La landing es HTML/CSS estático: sin JavaScript, sin fonts externas, sin imágenes
      externas, sin analytics/pixels, sin scripts de terceros.
- [ ] Se ve bien en mobile (~375px) y en desktop.
- [ ] Los 6 estilos aparecen con nombre, descripción, "ideal para" y link a su demo:
      Black Gold → bella-spa, Soft Blush → studio-blush, Charcoal Clean → north-barber,
      Warm Sand → glow-nails, Aqua Clean → aqua-wellness, Sage Calm → sage-studio.
- [ ] Los 6 links de demos abren desde la landing (HTTP 200).
- [ ] El pricing se muestra como tentativo de lanzamiento (Founder MXN $599 / USD $39,
      Standard MXN $999 / USD $69, corrección extra MXN $250–$400 / USD $15–$25) y se
      aclara pago único + cambios futuros aparte.
- [ ] El CTA "Producto en preparación" NO abre Stripe ni ningún checkout real; no hay
      Payment Link, Tally real ni formularios que envíen datos.
- [ ] El FAQ es honesto: reservas por WhatsApp/Instagram/Maps/link externo (sin sistema
      interno), colores solo por 6 estilos cerrados, cambios extra se cobran aparte,
      producto en preparación.
- [ ] El footer dice "Producto en construcción. Demos públicas con datos ficticios." y
      no incluye email real.
- [ ] No hay datos reales de clientes ni secrets en la landing.
- [ ] Las 6 demos y sus `qr.svg` siguen existiendo sin cambios.

## Phase 4C — Marca HMU Link, landing por idioma y dominio custom

- [ ] Existen `public/index.html` (default) y `public/es/index.html` (español), y abren
      en sus URLs públicas. No existe portada/selector intermedio.
- [ ] Las dos páginas usan la marca **HMU Link**; no mencionan MyGuest ni marcas viejas.
- [ ] Un botón de idioma en header y footer navega entre `/` y `/es/`; sin
      geolocalización, sin cookies, sin JS de redirección.
- [ ] `/es/` está en español (lang="es-MX"), WhatsApp-first, con CTA "Quiero mi HMU
      Link" (sin pago real) y "Ver demos"; precios MXN $599 / $999 / $250–$400 marcados
      como tentativos, pago único, checkout no activo.
- [ ] `/` está en inglés (lang="en-US"), con CTA "Get my HMU Link" (sin pago real) y
      "View examples"; precios USD $39 / $69 / $15–$25 marcados como launch pricing,
      one-time, checkout not active.
- [ ] Copy adaptado por mercado (no traducción literal): `/es/` enfocado en
      WhatsApp/preguntas repetidas; `/` enfocado en polished page / not ready for a
      full website.
- [x] Cada página tiene title, meta description, canonical y hreflang
      (es-MX / en-US / x-default) apuntando al dominio activo.
- [x] Las dos páginas son HTML/CSS estático: sin analytics/pixels, sin scripts de
      terceros, sin formularios reales.
- [x] Los 12 estilos aparecen en `/` y `/es/` con una captura real de su demo (no un
      mockup CSS abstracto) y link a la demo; las imágenes cargan sin 404.
- [x] Dominio custom: `www.hmulink.com` está activo. `/`, `/es/`, las 12 demos
      y todos los `qr.svg` responden 200 en el dominio custom y HTTPS es válido.
- [x] Sin wildcard DNS; sin subdominios adicionales.
- [x] Las 12 demos y sus `qr.svg` siguen existiendo sin cambios funcionales.

## Phase 4D — Identidad visual HMU Link

- [ ] `/` y `/es/` usan la paleta oficial (Bubblegum #f478b0, Tangerine #ffa934,
      Ocean Blue #00a0b5, Banana #ffef5a, Avocado #98c54e, Bell Pepper #14704f) y no
      queda el esquema oscuro/dorado anterior ni morado como color principal.
- [ ] La jerarquía de color es ordenada: bubblegum en CTA principal, ocean en
      links/acentos de confianza, tangerine en badges, banana como highlight/fondo,
      avocado como acento secundario, bell pepper como oscuro de soporte.
- [ ] Logo textual "HMU Link" visible en header y footer: HMU bubblegum, Link ocean,
      pin tangerine; sin tagline dentro del logo.
- [ ] Slogans "Conecta tu negocio" (/es/) y "Connect your business" (/) aparecen como
      copy, no como parte del logo.
- [ ] El look es playful pero no infantil ni demasiado femenino; funciona para
      barberías y tours igual que para spas.
- [ ] Botones redondeados y legibles; contraste suficiente en CTA y pricing.
- [ ] Se ve bien en mobile (~375px) y desktop en las dos páginas.
- [ ] El copy estratégico por mercado, los precios tentativos, los 6 estilos con sus
      demos y los avisos de checkout inactivo se mantienen sin cambios.
- [ ] Logo final como asset sigue pendiente y está documentado.

## Phase 4E — Migración a dominio custom

- [x] Archivo `public/CNAME` creado con contenido exacto: `www.hmulink.com`
- [x] Los 12 `public_url` en `data/demos/*.json` actualizados a `https://www.hmulink.com/demos/<slug>/`
- [x] `DEMO_BASE_URL` en `generator/generate_service_menu.py` actualizado a `https://www.hmulink.com/demos`
- [x] Footer de demos regenerado: dice "HMU Link - Demo" (no "Service Menu App - Demo")
- [x] Los 12 demos regenerados: `python generator/generate_service_menu.py` exitoso
- [x] Los 12 `qr.svg` regenerados y contienen xmlns válido
- [x] Canonical de `/` es `https://www.hmulink.com/`
- [x] Canonical de `/es/` es `https://www.hmulink.com/es/`
- [x] hreflang es-MX apunta a `https://www.hmulink.com/es/`
- [x] hreflang en-US apunta a `https://www.hmulink.com/`
- [x] hreflang x-default apunta a `https://www.hmulink.com/`
- [x] og:url y og:image actualizados en ambas páginas
- [x] Sin referencias a `yuyitov.github.io` en archivos públicos HTML
- [x] Sin referencias a `demo.servicemenu.example` ni antiguos URLs en payloads
- [x] No hay `{{...}}` tokens sin interpolar en archivos públicos
- [x] Sin secretos, sin datos reales de clientes
- [x] MyGuest no fue tocado

## Phase 4F — Copy, densidad de info, 12 estilos, pricing único y animación

- [ ] El hero de `/` ya no lidera con WhatsApp: mensaje neutral de canal ("call, text,
      or DM"); `/es/` conserva su mensaje WhatsApp-first sin cambios.
- [ ] La cinta amarilla (ticker) se ve recta, sin inclinación, en ambas páginas.
- [ ] La tercera tarjeta de "Qué es"/"What it is" dice "Sin complicaciones"/"No hassle,
      ever" (ya no "sin dashboard").
- [ ] La sección "Qué incluye"/"What's included" muestra 6 chips compactos + 1 párrafo
      de exclusiones, no el comparativo de dos columnas anterior.
- [ ] Existen 12 estilos visuales (no 6), con pills de filtro (Todos / Belleza y
      Wellness / Fitness y Activo / Comida y Hospitalidad / Creativo y Servicios) que
      muestran/ocultan tarjetas correctamente al hacer clic.
- [ ] El pricing muestra **una sola tarjeta de precio** (USD $59 / MXN $799), no
      Founder/Standard separados; la corrección extra aparece como letra pequeña
      (~USD $3 / ~MXN $60), no como tarjeta propia.
- [ ] "Cómo funciona" tiene 5 pasos (no 6): pagar, llenar formulario, generar página,
      recibir link+QR por correo, usar la corrección incluida.
- [ ] El H1 del hero entra palabra por palabra (kinetic typography) al cargar la
      página, y respeta `prefers-reduced-motion` (aparece completo sin animación).
- [ ] Los blobs decorativos varían de velocidad de scroll-parallax entre sí (no todos
      se mueven idéntico) y respetan `prefers-reduced-motion` (sin parallax).
- [ ] Al pasar el cursor sobre `.card` y las miniaturas de estilos (`.thumb`), se nota
      un tilt 3D sutil que seguido del cursor; se resetea al salir.
- [ ] Los checkmarks de los chips de "incluye" se dibujan (line-draw) al entrar en
      pantalla via scroll.
- [ ] No se agregaron dependencias nuevas al pipeline (`requirements.txt`,
      `generate-demos.yml`, `pages.yml` sin cambios de dependencias); las animaciones
      son CSS + el mismo `<script>` inline ya existente.

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

## CTAs e intake en vivo (Phase 4G/4H)

- [ ] https://tally.so/r/yPkN5X carga públicamente y está en inglés.
- [ ] https://tally.so/r/MeyDpk carga públicamente y está en español.
- [ ] El selector de estilo muestra las 12 imágenes de preview en ambos formularios.
- [ ] Los CTAs primarios de `/` abren el formulario EN con `?source=hmu_website_en`.
- [ ] Los CTAs primarios de `/es/` abren el formulario ES con `?source=hmu_website_es`.
- [ ] Todos los CTAs a Tally usan `target="_blank"` y `rel="noopener noreferrer"`.
- [ ] Los botones de demos/ejemplos siguen funcionando sin cambios.
- [ ] Ningún formulario tiene pagos, Stripe, webhooks, automatizaciones ni analytics.
- [ ] La landing no promete checkout activo ni cobro dentro del formulario.

## Páginas de clientes reales (Phase 5)

- [ ] Para cada cliente publicado se completó
      [FIRST_CLIENT_QA_CHECKLIST.md](FIRST_CLIENT_QA_CHECKLIST.md).
- [ ] `data/clients/` contiene solo JSONs con información pública aprobada
      (sin correos internos, teléfonos internos, pagos ni notas privadas).
- [ ] `public/links/<slug>/` y su versión alterna cargan en vivo; el QR escanea
      a la URL por defecto.
- [ ] Los demos bajo `/demos/` siguen intactos tras generar clientes.

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
