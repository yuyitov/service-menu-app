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

## Phase 5 — Stripe/Tally

- Conectar Stripe Payment Link real y su webhook.
- Conectar formulario Tally real y su webhook.
- Validación de firmas de ambos webhooks (ver [SECURITY.md](SECURITY.md)).
- Checklist de secrets futuros completado antes de esta fase.

## Phase 6 — Emails y correcciones

- Integración con proveedor de email (Resend u otro) para email post-pago y email de
  entrega.
- Implementación completa del flujo de corrección one-time.

## Phase 7 — QA end-to-end

- Recorrer [QA_CHECKLIST.md](QA_CHECKLIST.md) completo con el pipeline real conectado.
- Prueba end-to-end: pago dummy → intake dummy → generación → publicación → entrega →
  corrección.
- Verificación de idempotencia con eventos duplicados reales de Stripe/Tally.

## Phase 8 — Checkout activo, pricing final y primeras ventas

- Activar el checkout real en la landing (hasta entonces el pricing es tentativo).
- Confirmar paquetes/precios definidos en [PRODUCT_SPEC.md](PRODUCT_SPEC.md) contra
  mercado real.
- Primeras ventas reales, documentadas siguiendo
  [RUNBOOK.md](RUNBOOK.md#cómo-documentar-la-primera-venta).
