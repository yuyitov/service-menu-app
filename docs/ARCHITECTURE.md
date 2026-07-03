# Architecture — Service Menu App

Arquitectura conceptual. Nada de esto está implementado en Phase 0; este documento existe
para aprobar el diseño antes de escribir código de integración.

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
  (`.github/workflows/generate-demos.yml`) solo **valida** que las 6 demos generan
  `index.html` + `qr.svg` sin errores, sin tokens residuales, sin secrets y sin
  referencias a MyGuest.

## Demos públicas en GitHub Pages (Phase 3B)

- Phase 3A conectó el repo a GitHub (`yuyitov/service-menu-app`, rama `main`) y validó
  `generate-demos.yml` en Actions.
- Phase 3B **publica las demos** en GitHub Pages mediante un workflow dedicado
  (`.github/workflows/pages.yml`): en cada push a `main` regenera las 6 demos desde cero,
  repite las verificaciones de validación (outputs, tokens, secrets, MyGuest) y despliega
  **solo la carpeta `public/`** con `actions/upload-pages-artifact` + `actions/deploy-pages`.
- El deploy usa el `GITHUB_TOKEN` efímero del propio workflow con permisos mínimos
  (`contents: read`, `pages: write`, `id-token: write`). **No usa secrets configurados.**
- URL base pública: `https://yuyitov.github.io/service-menu-app/`. Los `public_url` de los
  6 payloads demo y sus QR apuntan a `.../demos/<slug>/`.
- `generate-demos.yml` se mantiene como workflow de **validación** independiente en
  push/PR; `pages.yml` es el único que despliega.
- Sin dominio custom todavía (fase posterior).

## Landing multi-mercado HMU Link (Phase 4C)

- La marca pública provisional es **HMU Link**. La landing se divide en tres páginas
  estáticas mantenidas a mano (no generadas): `public/index.html` (portada/selector de
  mercado), `public/mx/index.html` (México, español, MXN) y `public/us/index.html`
  (USA/Canadá, inglés, USD).
- El usuario elige su mercado manualmente: **sin geolocalización, sin cookies, sin
  JavaScript de redirección**. Metadata estática por página (`lang`, canonical,
  `hreflang` es-MX / en-US / x-default).
- Sigue sin haber backend dinámico: todo es HTML/CSS estático publicado por `pages.yml`.

## Dominio custom hmulink.com (Phase 4C)

- Dominio comprado en Cloudflare: `hmulink.com`. Dominio principal deseado:
  `www.hmulink.com` (apex redirige a www). Sin wildcard DNS y sin subdominios
  adicionales por ahora.
- **Estado: pendiente.** El DNS de la zona aún no tiene registros para `www` ni A records
  en el apex. El custom domain **no** se configura en GitHub Pages hasta que el DNS
  exista, porque al configurarlo GitHub redirige `yuyitov.github.io/service-menu-app/` al
  dominio custom y las demos/QR quedarían rotas mientras el DNS no propague.
- Orden de activación: (1) crear en Cloudflare el CNAME `www → yuyitov.github.io`
  (DNS only) y los A records del apex de GitHub Pages; (2) configurar
  `www.hmulink.com` como custom domain del repo (Settings → Pages o
  `gh api -X PUT repos/yuyitov/service-menu-app/pages -f cname=www.hmulink.com`);
  (3) esperar validación DNS + certificado HTTPS de GitHub; (4) activar "Enforce HTTPS";
  (5) actualizar `public_url` de las 6 demos, `DEMO_BASE_URL`, canonicals/hreflang y
  regenerar QRs.
- Cuando el dominio esté activo, GitHub Pages redirige automáticamente las URLs
  `yuyitov.github.io/service-menu-app/...` al dominio custom, así los QR viejos no se
  rompen.

## Landing comercial pública (Phase 4)

- La landing comercial vive en `public/index.html` y se publica en la **raíz** de GitHub
  Pages (`https://yuyitov.github.io/service-menu-app/`) por el mismo workflow `pages.yml`
  que ya publica toda la carpeta `public/` — no requirió cambios de workflow.
- Es **estática y pública**: HTML/CSS puro, sin JavaScript, sin fonts ni imágenes
  externas, sin analytics y sin formularios reales. No se genera con el generador de
  demos; es un archivo mantenido a mano.
- Enlaza las 6 demos públicas y muestra pricing tentativo. **No** integra Stripe, Tally,
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
