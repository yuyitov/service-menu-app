# Architecture — Service Menu App

Arquitectura conceptual de la **automatización futura** (Stripe/Worker/KV/emails). Nada de
esto está implementado; este documento existe para aprobar el diseño antes de escribir
código de integración.

## Estado actual (Phase 5 — flujo manual, sin backend)

Lo único operativo hoy es estático y manual:

- **Intake**: formularios Tally publicados (EN `yPkN5X`, ES `MeyDpk`), conectados desde
  los CTAs de la landing. Sin webhooks: las submissions se revisan a mano en Tally.
- **Clientes reales**: `data/clients/<slug>.client.json` (`client_payload_public` v1,
  solo datos públicos) → generador local → `public/links/<slug>/` bilingüe (idioma por
  defecto en la raíz, alterno en `/en/` o `/es/`, canonical + hreflang, un QR) →
  commit/push → GitHub Actions → GitHub Pages.
- **Demos**: `data/demos/*.json` → `public/demos/<slug>/`, sin cambios.
- **Cobro**: manual (ver [PILOT_PAYMENT_AND_DELIVERY.md](PILOT_PAYMENT_AND_DELIVERY.md)).

Todo lo que sigue en este documento es el diseño futuro.

## Componentes

- **Stripe** — Payment Link para el checkout inicial. Webhook dispara la creación del
  `service_menu_order`.
- **Email post-pago** — envía al comprador el link del formulario Tally.
- **Tally** — formulario de intake donde el negocio ingresa sus datos.
- **Cloudflare Worker** (`service-menu-worker`, nombre propio, no compartido con MyGuest) —
  recibe webhooks de Stripe y Tally, valida, escribe a KV, dispara GitHub Actions. El
  Worker no descarga ni procesa imágenes: solo maneja URLs/referencias como texto.
- **Cloudflare KV** (namespace `SERVICE_MENU_KV`, propio) — almacena `service_menu_order`,
  `service_menu_intake`, `service_menu_delivery`, `service_menu_correction`.
- **GitHub Actions** — en un repo propio (`service-menu-app` o `service-menu-pages`,
  separado de MyGuest), genera el HTML estático de la página a partir del
  `service_menu_payload_public`, y genera el QR como asset estático (ver más abajo).
- **GitHub Pages** — hosting estático de las páginas publicadas.
- **Resend (o proveedor de email equivalente)** — envío del email de entrega con link y QR.
- **Correction link one-time** — token único, de un solo uso, que permite al cliente
  enviar una corrección acotada mediante **campos controlados** (`correction_notes`,
  `corrected_services_text`, `corrected_hours_text`, `corrected_whatsapp`,
  `corrected_instagram`, `corrected_policies`; ver [DATA_CONTRACT.md](DATA_CONTRACT.md)),
  no edición libre ni dashboard, y dispara una republicación.

## Flujo normal

```
1. Cliente paga vía Stripe Payment Link.
2. Stripe webhook → Worker crea service_menu_order (status: paid).
3. Worker envía email post-pago con link a Tally → status: intake_sent.
4. Cliente completa Tally → Tally webhook → Worker.
5. Worker valida order_id, guarda service_menu_intake en KV → status: intake_received.
6. Worker dispara GitHub Actions (repository_dispatch) → status: generating.
7. GitHub Actions transforma intake → service_menu_payload_public, genera HTML y genera
   el QR como asset estático (qr_asset_url), hace commit/push a GitHub Pages.
   El QR se genera en GitHub Actions, no en el Worker; el Worker nunca descarga ni
   procesa imágenes.
8. GitHub Pages publica la página (incluyendo el QR como asset) → status: published.
9. GitHub Actions (o Worker) notifica entrega: guarda service_menu_delivery,
   envía email de entrega con public_url + QR + correction_token → status: delivered.
```

## Flujo de corrección

```
1. Cliente abre el correction link (contiene correction_token).
2. Worker valida: token existe, no ha sido usado, pertenece al order_id correcto.
3. Cliente envía la corrección mediante campos controlados (correction_notes,
   corrected_services_text, corrected_hours_text, corrected_whatsapp,
   corrected_instagram, corrected_policies), vía Tally de corrección o formulario
   reducido — no hay edición libre del intake completo ni dashboard.
4. Worker guarda service_menu_correction (requested_at) → status: correction_requested.
5. Worker reemplaza únicamente los campos controlados presentes sobre el intake
   original, dispara GitHub Actions de nuevo.
6. Página se republica con los cambios (incluyendo regeneración del QR si cambia el slug/
   URL; normalmente el QR no cambia porque el public_url se mantiene).
7. Worker marca correction_token como usado (used_at) → status: correction_used.
8. Intentos posteriores con el mismo token son rechazados.
```

## Flujo de error

```
- Cualquier paso puede fallar (webhook malformado, Tally sin order_id válido,
  GitHub Actions falla el build, email no se envía).
- El Worker registra el error y marca status: failed, conservando el último estado
  válido conocido para poder reintentar manualmente.
- No hay reintentos automáticos silenciosos en el MVP: un fallo requiere revisión
  manual vía RUNBOOK.md antes de reintentar.
```

## Idempotencia

- `order_id` es la clave de idempotencia principal en todo el pipeline.
- El webhook de Stripe se procesa una sola vez por `payment_intent_id`: si el Worker
  recibe el mismo evento dos veces, no debe crear un segundo `service_menu_order`.
- El submission de Tally se acepta solo si trae un `order_id` válido y existente, y solo
  se procesa una vez por `order_id` (un segundo submission con el mismo `order_id` en
  estado ≥ `intake_received` se rechaza o se trata como intento de corrección, nunca
  como intake nuevo).
- `correction_token` es de un solo uso: una vez marcado `used_at`, cualquier intento
  posterior con ese token se rechaza.
- La generación de la página (GitHub Actions) es determinística: correr el mismo
  `service_menu_payload_public` dos veces produce el mismo HTML, permitiendo reintentos
  seguros del build sin efectos secundarios.

## Alcance de imágenes en Phase 1

- Uploads reales de imágenes (subida de archivos por el cliente) quedan **fuera de
  alcance de Phase 1**. Phase 1 trabaja con datos dummy y `primary_image_url`/`logo_url`
  opcionales (ver [DATA_CONTRACT.md](DATA_CONTRACT.md)): si no hay URL, el generador usa
  un placeholder/template por defecto.
- Un flujo de upload real (validación de tipo/tamaño, almacenamiento) se diseñará en una
  fase posterior, cuando se conecte el intake real (Phase 4 en adelante); no es parte del
  generador HTML base ni de las demos de Phase 1.

## QR estático (Phase 2)

- El QR se genera como **asset estático** durante la generación de la página, junto al
  `index.html` (`public/demos/<slug>/qr.svg`). En Phase 2 lo produce el propio generador
  local; el diseño final lo ejecutará GitHub Actions (ver flujo normal, paso 7).
- Se genera en el paso de build (nunca en el Worker: el Worker no descarga ni procesa
  imágenes). Formato **SVG** vía `segno` (Python puro, sin libs de imagen pesadas).
- El QR codifica el `public_url`, es **estático** (no dinámico), **sin tracking** y **sin
  tokens** — solo datos públicos.
- Phase 2 **no** publica a GitHub Pages ni usa secrets: un workflow
  (`.github/workflows/generate-demos.yml`) solo **valida** que las 12 demos generan
  `index.html` + `qr.svg` sin errores, sin tokens residuales, sin secrets y sin
  referencias a MyGuest.

## Demos públicas en GitHub Pages (Phase 3B)

- Phase 3A conectó el repo a GitHub (`yuyitov/service-menu-app`, rama `main`) y validó
  `generate-demos.yml` en Actions.
- Phase 3B **publica las demos** en GitHub Pages mediante un workflow dedicado
  (`.github/workflows/pages.yml`): en cada push a `main` regenera las 12 demos desde
  cero, repite las verificaciones de validación (outputs, tokens, secrets, MyGuest) y
  despliega **solo la carpeta `public/`** con `actions/upload-pages-artifact` +
  `actions/deploy-pages`.
- El deploy usa el `GITHUB_TOKEN` efímero del propio workflow con permisos mínimos
  (`contents: read`, `pages: write`, `id-token: write`). **No usa secrets configurados.**
- URL base pública: `https://www.hmulink.com/` (dominio custom activo desde Phase 4E).
  Los `public_url` de los 12 payloads demo y sus QR apuntan a
  `https://www.hmulink.com/demos/<slug>/`.
- `generate-demos.yml` se mantiene como workflow de **validación** independiente en
  push/PR; `pages.yml` es el único que despliega.
- Archivo `public/CNAME` contiene `www.hmulink.com` para instrucciones a GitHub Pages.

## Landing por idioma HMU Link (Phase 4C, reestructurada)

- La marca pública provisional es **HMU Link**. La landing se divide en dos páginas
  estáticas mantenidas a mano (no generadas): `public/index.html` (default, inglés,
  USD, mercado USA/Canadá) y `public/es/index.html` (español, MXN, mercado México).
  No existe un selector/portada intermedio: cada idioma abre directo en su URL.
- El usuario cambia de idioma manualmente con un botón en el header y en el footer:
  **sin geolocalización, sin cookies, sin JavaScript de redirección**. Metadata
  estática por página (`lang`, canonical, `hreflang` es-MX / en-US / x-default).
- La sección "Estilos visuales" de ambas landings usa capturas reales (JPEG estático
  en `public/assets/previews/`) de las 12 demos publicadas, en vez de un mockup
  dibujado en CSS — así el cliente ve exactamente qué recibe al abrir su link/QR.
  Incluye pills de filtro por categoría de negocio (JS vanilla, sin recargar página).
- Sigue sin haber backend dinámico: todo es HTML/CSS estático publicado por `pages.yml`.

## Dominio custom hmulink.com (Phase 4E, activo)

- Dominio comprado en Cloudflare: `hmulink.com`. Dominio principal activo:
  `www.hmulink.com` (apex redirige a www).
- **Estado: activo desde Phase 4E.** El DNS está configurado:
  - CNAME `www → yuyitov.github.io` (DNS only, sin proxy)
  - A records del apex apuntan a GitHub Pages
  - GitHub Pages custom domain: `www.hmulink.com` configurado
  - HTTPS: activado y forzado
  - Certificado TLS válido
- Cambios realizados en Phase 4E:
  - Archivo `public/CNAME` creado con `www.hmulink.com`
  - `public_url` de las 12 demos actualizado a `https://www.hmulink.com/demos/<slug>/`
  - `DEMO_BASE_URL` en `generator/generate_service_menu.py` actualizado
  - Canonicals y hreflang en landing pages actualizados
  - QR codes regenerados con nuevas URLs
- GitHub Pages redirige automáticamente las URLs antiguas `yuyitov.github.io/service-menu-app/...`
  al dominio custom.

## Landing comercial pública (Phase 4, publicado en dominio custom Phase 4E)

- La landing comercial vive en `public/index.html` y se publica en la **raíz** del sitio
  (`https://www.hmulink.com/`) por el mismo workflow `pages.yml` que ya publica toda la
  carpeta `public/` — no requirió cambios de workflow.
- Es **estática y pública**: HTML/CSS puro, sin JavaScript, sin fonts ni imágenes
  externas, sin analytics y sin formularios reales. No se genera con el generador de
  demos; es un archivo mantenido a mano.
- Enlaza las 12 demos públicas y muestra pricing tentativo. **No** integra Stripe, Tally,
  Worker, KV ni email: el checkout se activa en una fase posterior.

## Separación total respecto a MyGuest

- Repo propio, sin relación de historial git con el repo de MyGuest.
- Worker propio, con su propio nombre y su propia cuenta/route en Cloudflare.
- KV namespace propio, nunca compartido ni reutilizado.
- Ningún secret de MyGuest se copia o reutiliza; todos los secrets de Service Menu App
  se crean desde cero (ver [SECURITY.md](SECURITY.md)).
- Dominio y GitHub Pages propios, no se despliega bajo el dominio ni el proyecto de
  MyGuest.
- GitHub Actions workflows propios, en el repo de Service Menu App, sin depender de
  workflows de MyGuest.

## Naming sugerido

| Recurso | Nombre sugerido |
|---|---|
| Repo principal | `service-menu-app` |
| Repo de páginas publicadas (si se separa) | `service-menu-pages` |
| Worker | `service-menu-worker` |
| KV namespace | `SERVICE_MENU_KV` |
| Workflow: generar página | `.github/workflows/generate-page.yml` |
| Workflow: aplicar corrección | `.github/workflows/apply-correction.yml` |
| Variable de entorno Worker | `SERVICE_MENU_STRIPE_WEBHOOK_SECRET`, `SERVICE_MENU_TALLY_WEBHOOK_SECRET`, `SERVICE_MENU_GITHUB_TOKEN`, `SERVICE_MENU_RESEND_API_KEY` |

Todos los nombres usan el prefijo `service-menu` o `SERVICE_MENU_` para evitar cualquier
colisión o confusión con recursos de MyGuest.
