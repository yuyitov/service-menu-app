# Roadmap — Service Menu App

## Phase 0 — Documentación y arquitectura

Estado actual. Definir y aprobar:

- Estructura del repo.
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md): alcance del MVP.
- [DATA_CONTRACT.md](DATA_CONTRACT.md): modelo de datos.
- [ARCHITECTURE.md](ARCHITECTURE.md): diseño técnico.
- [SECURITY.md](SECURITY.md): reglas de seguridad y separación de MyGuest.

Sin código funcional. Salida de esta fase: arquitectura y contrato de datos aprobados por
el usuario.

## Phase 1 — Generador HTML + demos dummy

- Implementar el generador que transforma `service_menu_payload_public` en HTML estático.
- Soportar los 6 estilos cerrados de `brand_style` (`black-gold`, `soft-blush`,
  `charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`) mediante un template base
  común + una paleta CSS por estilo. Sin colores libres.
- Crear una página demo por estilo (6) con datos ficticios para validar diseño y contenido.
- Validar contra [QA_CHECKLIST.md](QA_CHECKLIST.md) (secciones de generación, campos,
  mobile, caracteres especiales, links).
- Sin integración con Stripe/Tally/Worker todavía; payloads de entrada son archivos
  locales.

## Phase 2 — QR estático + GitHub Actions (validación)

- Generación de **QR real estático** (`qr.svg`) por demo, junto al `index.html`,
  apuntando al `public_url`. Vía `segno` (Python puro, SVG). Sin tracking ni tokens.
- Sección "Comparte esta página" en la página: QR + link visible + botón "Abrir página",
  mobile-first y compatible con los 6 estilos.
- Workflow `.github/workflows/generate-demos.yml` que en push/PR ejecuta el generador y
  **valida** que las 6 demos producen `index.html` + `qr.svg`, sin tokens residuales, sin
  secrets y sin referencias a MyGuest.
- **Aún no** publica a GitHub Pages ni usa secrets: la publicación automática a Pages se
  aborda en una fase posterior. Convenciones de naming en
  [ARCHITECTURE.md](ARCHITECTURE.md#naming-sugerido).

## Phase 3A — Repo en GitHub + CI validado ✅

- Repo remoto `yuyitov/service-menu-app` creado, rama `main`, primer push hecho.
- Workflow `generate-demos.yml` corrió y pasó en GitHub Actions.
- Sin secrets, sin Pages, sin tocar MyGuest.

## Phase 3B — Demos públicas en GitHub Pages ✅

- GitHub Pages habilitado para este repo (build via GitHub Actions, sin secrets).
- Workflow `pages.yml`: en push a `main` regenera las demos, repite las validaciones y
  publica **solo `public/`** con permisos mínimos.
- `public_url` de los 6 payloads demo actualizados a
  `https://yuyitov.github.io/service-menu-app/demos/<slug>/`; QRs regenerados apuntando a
  las URLs públicas reales.
- `generate-demos.yml` se mantiene como validación separada.
- Sin dominio custom, sin Stripe/Tally/Worker/KV/emails (fases posteriores).

## Phase 3C — Worker + KV

- Cloudflare Worker propio (`service-menu-worker`) con KV namespace propio
  (`SERVICE_MENU_KV`).
- Endpoints para recibir webhooks (aún sin conectar a Stripe/Tally reales; probar con
  requests simulados).
- Lógica de idempotencia por `order_id` y `correction_token`.
- Disparo de GitHub Actions vía `repository_dispatch`.

## Phase 4 — Landing comercial pública ✅

- Landing comercial estática en `public/index.html`, publicada en la raíz de GitHub
  Pages (`https://yuyitov.github.io/service-menu-app/`).
- Presenta el producto con nombre provisional ("Service Pages" / "Service Menu App"),
  explica qué es, para quién es, qué incluye y qué no incluye.
- Enlaza las 6 demos públicas como muestra de los 6 estilos cerrados.
- Muestra el pricing tentativo de lanzamiento (Founder / Standard / corrección extra),
  aclarando que el checkout **no** está activo todavía.
- HTML/CSS puro: sin JavaScript, sin fonts/imágenes externas, sin analytics, sin
  formularios reales, sin Stripe/Tally/Worker/KV/emails.

## Phase 4C — Marca HMU Link, landings por mercado y dominio custom ✅

- Marca pública provisional: **HMU Link** (reemplaza "Service Pages" en las páginas
  públicas; el repo mantiene su nombre interno).
- Landing reestructurada por mercado: `/` portada/selector, `/mx/` México (español,
  WhatsApp-first, MXN), `/us/` USA/Canadá (inglés, USD). Copy adaptado por mercado, no
  traducción literal. Sin geolocalización, sin cookies, sin JS.
- Metadata estática por página: title/description, `lang`, canonical y `hreflang`
  (es-MX / en-US / x-default).
- Dominio `hmulink.com` comprado en Cloudflare; principal deseado `www.hmulink.com`.
  DNS y custom domain en GitHub Pages **pendientes** (ver
  [ARCHITECTURE.md](ARCHITECTURE.md#dominio-custom-hmulinkcom-phase-4c)); QRs siguen en
  `yuyitov.github.io` hasta activarlo.
- Checkout sigue inactivo; precios de lanzamiento tentativos por mercado.

## Phase 4D — Identidad visual HMU Link

- Paleta oficial aplicada a `/`, `/mx/` y `/us/`: Bubblegum `#f478b0` (principal
  HMU/CTA), Ocean Blue `#00a0b5` (Link/confianza), Tangerine `#ffa934` (acentos/badges),
  Banana `#ffef5a` (highlights/fondos suaves), Avocado `#98c54e` (acento secundario),
  Bell Pepper `#14704f` (oscuro de soporte: pricing y footer).
- Dirección: alegre, moderna, friendly, playful pero no infantil, limpia pero no
  corporativa fría; neutral para salones, spas, barberías, tours, restaurantes, coaches
  y servicios locales en general.
- Logo textual temporal en CSS ("HMU" bubblegum + "Link" ocean + pin tangerine), sin
  tagline dentro del logo. Slogans como copy de marketing: "Conecta tu negocio" (MX) /
  "Connect your business" (US). **Logo final pendiente de exportar como asset.**
- Solo visual/branding estático: sin JS, sin assets externos, sin cambios de copy
  estratégico, precios ni arquitectura.

## Phase 4E — Landing elevada + reestructura por idioma (pendiente de commit)

- Rediseño visual elevado de las landings: tipografía Fraunces/Outfit (Google Fonts),
  animaciones de scroll-reveal, ticker, mockup de teléfono en el hero y
  micro-interacciones en CTAs. Sigue sin backend, sin forms reales, sin
  analytics/tracking.
- Reestructura de arquitectura: se elimina la portada/selector de mercado intermedio.
  `/` pasa a ser la landing por default (inglés, USD) y `/mx/` se renombra a `/es/`
  (español, MXN). Un botón de idioma en header y footer navega entre ambas. `/mx/` y
  `/us/` quedan eliminadas sin redirects (el producto aún no lanza).
- La sección "Estilos visuales" reemplaza los mockups CSS abstractos por capturas
  reales (`public/assets/previews/`) de las 6 demos ya publicadas, para que el
  cliente vea exactamente qué recibiría al abrir su link o escanear su QR.
- Pendiente de commit y revisión visual antes de publicar.

## Phase 4F — Copy, densidad de info, 12 estilos, pricing único y animación (pendiente de commit)

- Copy: hero de `/` deja de liderar con WhatsApp ("Everything your clients ask by
  call, text, or DM"); `/es/` no cambia (WhatsApp sí domina en México). Tercera
  tarjeta de "Qué es" pasa de "sin dashboard" a "Sin complicaciones"/"No hassle,
  ever". Pasos de "Cómo funciona" bajan de 6 a 5.
- La cinta amarilla del ticker se endereza (ya no está inclinada).
- La sección "Qué incluye" pasa de un comparativo de dos columnas (~19 líneas) a 6
  chips compactos + 1 párrafo de exclusiones.
- Pricing pasa de dos niveles (Founder/Standard) a **un solo precio** (USD $59 /
  MXN $799, pago único); la corrección extra baja de USD $15–25 / MXN $250–400 a
  ~USD $3 / ~MXN $60.
- De 6 a **12 estilos visuales cerrados**: se agregan `electric-slate` (fitness),
  `terracotta-warm` (restaurantes), `sunny-paws` (pet grooming), `midnight-ink`
  (tatuajes), `clarity-editorial` (coaches/consultores) y `horizon-teal` (tours),
  cada uno con su paleta (`generator/styles/`), payload demo (`data/demos/`) y
  captura real (`public/assets/previews/`). La sección de estilos agrega pills de
  filtro por categoría (Belleza y Wellness / Fitness y Activo / Comida y
  Hospitalidad / Creativo y Servicios).
- Animación premium sin dependencias nuevas (sin GSAP/Lottie): kinetic typography
  en el H1 del hero, parallax scrub de blobs ligado al scroll, tilt 3D con cursor
  extendido a tarjetas y miniaturas de estilos, checkmarks con line-draw SVG, y
  micro-interacciones en botones. Todo vía CSS + el mismo `<script>` inline ya
  existente; `prefers-reduced-motion` sigue desactivando todo.
- Pendiente de commit y revisión visual antes de publicar.

## Phase 4E — Migración a dominio custom www.hmulink.com ✅

- Configuración de Cloudflare DNS: CNAME `www → yuyitov.github.io` + A records apex.
- Configuración de GitHub Pages custom domain: `www.hmulink.com` en Settings.
- HTTPS y Enforce HTTPS: activados.
- Archivo `public/CNAME` con `www.hmulink.com` creado.
- Actualización de `public_url` en todos los payloads demo a `https://www.hmulink.com/demos/<slug>/`.
- Actualización de `DEMO_BASE_URL` en `generator/generate_service_menu.py` a `https://www.hmulink.com/demos`.
- Regeneración de todos los demos y QR codes.
- Actualización de canonicals y hreflang en landing pages (`/` y `/es/`).
- Actualización de og:url e og:image en metadatos.
- Footer de demos rebrandizado: "HMU Link - Demo" (no "Service Menu App - Demo").
- Documentación actualizada (README, ARCHITECTURE, QA_CHECKLIST).
- Verificación: https://www.hmulink.com/ → HTTP 200, HTTPS válido, QRs codifican URLs correctas.

## Phase 4G — Intake forms conectados ✅

- Formularios de intake bilingües creados y publicados en Tally:
  - Inglés: https://tally.so/r/yPkN5X
  - Español: https://tally.so/r/MeyDpk
- CTAs primarios de la landing (`/` y `/es/`) conectados a su formulario por idioma,
  con `?source=hmu_website_en|es`, `target="_blank"` y `rel="noopener noreferrer"`.
- Sin Stripe, pagos, webhooks, automatizaciones ni analytics en los formularios.

## Phase 4H — QA en vivo de formularios y CTAs ✅

- Verificado que ambos formularios publicados cargan públicamente (HTTP 200,
  status PUBLISHED en Tally).
- Verificados CTAs de hero, pricing, acceso anticipado y header en ambas landings.
- Copy de "coming soon" actualizado a acceso anticipado abierto, manteniendo honesto
  que el checkout no está activo y que el formulario no cobra.
- Checklist de verificación en vivo agregado a [QA_CHECKLIST.md](QA_CHECKLIST.md).

## Phase 5A-prep — Flujo manual del primer cliente ✅

- [FIRST_CLIENT_RUNBOOK.md](FIRST_CLIENT_RUNBOOK.md): proceso manual A–M desde el
  lead en Tally hasta la publicación final, con reglas de seguridad estrictas.
- [CLIENT_PUBLIC_DATA_CHECKLIST.md](CLIENT_PUBLIC_DATA_CHECKLIST.md): qué puede ser
  público, qué es interno, qué nunca se recolecta y qué confirmar antes de publicar.
- El cobro del primer cliente es manual; Stripe/checkout siguen fuera de alcance.

## Phase 5 — Primer cliente real (manual) ✅

Listo para vender y entregar el primer cliente de forma manual y segura:

- **Generador bilingüe de clientes reales**: `data/clients/*.json`
  (`client_payload_public` v1) → `public/links/<slug>/` con idioma por defecto
  en la raíz, alterno en `/en/` o `/es/`, switch de idioma, canonical +
  hreflang estáticos, un QR a la URL por defecto, botones ampliados
  (tel:, mailto:, website, booking, Facebook, TikTok). Demos intactos.
- **Plantilla segura**: `data/clients/_template.client.json` (solo placeholders;
  archivos `_*` ignorados por el generador) + `data/clients/README.md`.
- **Operación**: [FIRST_CLIENT_RUNBOOK.md](FIRST_CLIENT_RUNBOOK.md) (A–M),
  [INTAKE_TO_CLIENT_JSON_GUIDE.md](INTAKE_TO_CLIENT_JSON_GUIDE.md),
  [FIRST_CLIENT_QA_CHECKLIST.md](FIRST_CLIENT_QA_CHECKLIST.md),
  [PILOT_PAYMENT_AND_DELIVERY.md](PILOT_PAYMENT_AND_DELIVERY.md) (cobro manual,
  sin Stripe) y [SALES_MESSAGES.md](SALES_MESSAGES.md).
- **Contrato**: `client_payload_public` v1 documentado en
  [DATA_CONTRACT.md](DATA_CONTRACT.md) con campos públicos / internos /
  futuros / prohibidos.
- Sin Stripe, pagos, Worker, KV, backend, emails, webhooks, analytics ni
  datos de clientes reales.

## Phase 6 — Stripe/Tally (automatización)

- Conectar Stripe Payment Link real y su webhook.
- Conectar formulario Tally real y su webhook.
- Validación de firmas de ambos webhooks (ver [SECURITY.md](SECURITY.md)).
- Checklist de secrets futuros completado antes de esta fase.

## Phase 7 — Emails y correcciones

- Integración con proveedor de email (Resend u otro) para email post-pago y email de
  entrega.
- Implementación completa del flujo de corrección one-time.

## Phase 8 — QA end-to-end

- Recorrer [QA_CHECKLIST.md](QA_CHECKLIST.md) completo con el pipeline real conectado.
- Prueba end-to-end: pago dummy → intake dummy → generación → publicación → entrega →
  corrección.
- Verificación de idempotencia con eventos duplicados reales de Stripe/Tally.

## Phase 9 — Checkout activo, pricing final y primeras ventas

- Activar el checkout real en la landing (hasta entonces el pricing es tentativo).
- Confirmar paquetes/precios definidos en [PRODUCT_SPEC.md](PRODUCT_SPEC.md) contra
  mercado real.
- Primeras ventas reales, documentadas siguiendo
  [RUNBOOK.md](RUNBOOK.md#cómo-documentar-la-primera-venta).
