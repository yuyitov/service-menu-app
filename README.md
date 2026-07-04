# Service Menu App (marca pública: HMU Link)

## Qué es

Service Menu App (nombre interno del repo) — con marca pública provisional **HMU Link** —
es un producto que genera **páginas digitales de servicios** para salones,
spas, negocios de wellness y comercios locales. Cada página pública muestra servicios,
precios, paquetes, horarios, ubicación, WhatsApp, Instagram, Google Maps, Google Reviews
y políticas básicas del negocio, con un link visible y un QR descargable para compartir.

El producto final que se entrega a cada cliente es un **Service Menu Page + link + QR kit**.

## Proyecto separado de MyGuest

Este es un proyecto **nuevo e independiente**, sin relación de código, infraestructura ni
datos con MyGuest.

- No modifica MyGuest.
- No usa el repositorio de MyGuest.
- No toca el Worker, KV, GitHub Actions, GitHub Pages, Tally, Stripe, secrets ni dominio
  productivos de MyGuest.
- No copia secrets de MyGuest.
- Toda infraestructura futura (Worker, KV, Pages, repo, dominios) será nombrada y
  desplegada de forma completamente separada. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Flujo futuro de automatización (no implementado aún)

```
Stripe Payment Link
  → email post-pago
  → Tally intake
  → Cloudflare Worker
  → Cloudflare KV
  → GitHub Actions
  → GitHub Pages
  → email de entrega
  → correction link one-time
```

El cliente paga, llena un formulario de intake, y de forma automatizada recibe su página
publicada más un email de entrega con el link y el QR. Tiene derecho a una corrección
incluida vía un link de un solo uso.

## Estado actual

**Phase 5 — Listo para vender y entregar el primer cliente real (manual).**

El generador soporta **clientes reales bilingües**: un JSON público en
`data/clients/<slug>.client.json` produce `public/links/<slug>/` (idioma por
defecto elegido por el cliente) + `/en/` o `/es/` (idioma alterno), con switch
de idioma, canonical/hreflang y un QR apuntando a la URL por defecto. Las demos
en `/demos/` no cambian. Operación manual documentada en
[docs/FIRST_CLIENT_RUNBOOK.md](docs/FIRST_CLIENT_RUNBOOK.md),
[docs/INTAKE_TO_CLIENT_JSON_GUIDE.md](docs/INTAKE_TO_CLIENT_JSON_GUIDE.md),
[docs/FIRST_CLIENT_QA_CHECKLIST.md](docs/FIRST_CLIENT_QA_CHECKLIST.md),
[docs/PILOT_PAYMENT_AND_DELIVERY.md](docs/PILOT_PAYMENT_AND_DELIVERY.md) y
[docs/SALES_MESSAGES.md](docs/SALES_MESSAGES.md). Cobro manual: sin Stripe,
sin checkout, sin webhooks.

**Phase 4G/4H — Intake forms conectados · Phase 5A-prep — flujo manual del primer cliente listo.**

Los CTAs primarios de la landing ahora abren los formularios de intake publicados en Tally
(sin pagos, sin webhooks, sin automatizaciones):

- Intake en inglés: https://tally.so/r/yPkN5X (desde `/` con `?source=hmu_website_en`)
- Intake en español: https://tally.so/r/MeyDpk (desde `/es/` con `?source=hmu_website_es`)

El primer cliente se atiende manualmente siguiendo
[docs/FIRST_CLIENT_RUNBOOK.md](docs/FIRST_CLIENT_RUNBOOK.md) y
[docs/CLIENT_PUBLIC_DATA_CHECKLIST.md](docs/CLIENT_PUBLIC_DATA_CHECKLIST.md).
El checkout no está activo: el cobro es manual en esta fase.

**Phase 4E — Migración a dominio custom completa.**

El sitio público de HMU Link está completamente migrado al dominio custom `https://www.hmulink.com`:
- Dominio: `www.hmulink.com` (apex redirige a www)
- GitHub Pages: custom domain configurado
- Cloudflare DNS: CNAME + records activos
- HTTPS: activado
- Archivo CNAME en `public/` creado
- URLs públicas actualizadas en landing + demos
- Códigos QR regenerados con nuevas URLs

Las dos páginas públicas (`/`, `/es/`) usan la identidad visual oficial de HMU
Link: paleta Bubblegum `#f478b0` / Tangerine `#ffa934` / Ocean Blue `#00a0b5` / Banana
`#ffef5a` / Avocado `#98c54e` / Bell Pepper `#14704f`, estilo playful + limpio +
profesional, botones redondeados, blobs decorativos en CSS y logo textual temporal
("HMU" en bubblegum + "Link" en ocean + pin tangerine). **Logo final pendiente de
exportar/aplicar como asset.**

La landing pública usa la marca **HMU Link** y está dividida por idioma
(no hay selector intermedio; cada idioma es directamente su página):

| Ruta | Contenido |
|---|---|
| `/` (`public/index.html`) | Landing por default, en inglés, precios USD (mercado USA/Canadá) |
| `/es/` (`public/es/index.html`) | Landing en español, precios MXN, WhatsApp-first (mercado México) |

Un botón de idioma en el header/footer navega entre ambas. Las dos páginas son
HTML/CSS estático: sin analytics y sin formularios reales. Los precios mostrados son
**de lanzamiento y tentativos**; el checkout no está activo.

Phase 0 (documentación) y Phase 1 (generador + estilos) están aprobadas. El generador
convierte un payload `service_menu_payload_public` (JSON dummy) en una página pública
mobile-first, en **12 estilos visuales cerrados**: `black-gold`, `soft-blush`,
`charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`, `electric-slate`,
`terracotta-warm`, `sunny-paws`, `midnight-ink`, `clarity-editorial`, `horizon-teal`.
Sin colores libres; la personalización es siempre por estilo cerrado.

Phase 2 agrega un **QR real estático** (`qr.svg`) por demo, apuntando al `public_url`, más
una sección "Comparte esta página" (QR + link visible + botón "Abrir página"). Un workflow
de GitHub Actions **valida** la generación de las 12 demos en cada push/PR.

Phase 3A conectó el repo a GitHub (`yuyitov/service-menu-app`) y validó el workflow de CI.
Phase 3B publica la carpeta `public/` en **GitHub Pages** vía un workflow dedicado
(`pages.yml`), sin secrets. Los `public_url` de las demos y sus QR apuntan a las URLs
públicas reales.

Todavía **no** hay Stripe, Tally, Cloudflare Worker/KV, emails reales, dashboard, login ni
dominio custom (fases posteriores). Los uploads de imágenes siguen fuera de alcance: si
faltan `primary_image_url` / `logo_url`, el generador usa un placeholder visual.

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para las fases siguientes.

## Demos públicas

Base: `https://www.hmulink.com/demos/`

| Demo | URL pública |
|---|---|
| Bella Spa | https://www.hmulink.com/demos/bella-spa/ |
| Studio Blush | https://www.hmulink.com/demos/studio-blush/ |
| North Barber | https://www.hmulink.com/demos/north-barber/ |
| Glow Nails | https://www.hmulink.com/demos/glow-nails/ |
| Aqua Wellness | https://www.hmulink.com/demos/aqua-wellness/ |
| Sage Studio | https://www.hmulink.com/demos/sage-studio/ |
| Pulse Fitness Studio | https://www.hmulink.com/demos/pulse-fitness/ |
| Café Terra | https://www.hmulink.com/demos/cafe-terra/ |
| Pawsome Grooming | https://www.hmulink.com/demos/pawsome-grooming/ |
| Iron & Ink Tattoo | https://www.hmulink.com/demos/iron-ink-tattoo/ |
| Clarity Coaching Co. | https://www.hmulink.com/demos/clarity-coaching/ |
| Horizon City Tours | https://www.hmulink.com/demos/horizon-tours/ |

El QR de cada demo está en `.../demos/<slug>/qr.svg` y codifica la URL pública de esa demo.

Para probar Pages: haz push a `main`, espera a que el workflow `pages` termine en la
pestaña Actions, y abre cualquiera de las URLs de la tabla (o escanea el QR desde la
sección "Comparte esta página").

## Cómo correr el generador

Requiere Python 3 y una dependencia ligera (`segno`, Python puro, para el QR SVG).

```bash
# 1) Instalar dependencias
pip install -r requirements.txt

# 2) Generar las 12 demos (data/demos/*.json) en public/demos/{slug}/
python generator/generate_service_menu.py

# O generar payloads específicos
python generator/generate_service_menu.py data/demos/bella-spa.json
```

Por cada demo se generan `public/demos/<slug>/index.html` y `public/demos/<slug>/qr.svg`.
Abre cualquier página en el navegador (idealmente en vista mobile); el QR aparece en la
sección "Comparte esta página". También puedes servir la carpeta localmente:

```bash
python -m http.server 8123 --directory public
# luego abre http://localhost:8123/demos/bella-spa/index.html
# el QR está en    http://localhost:8123/demos/bella-spa/qr.svg
```

Estructura del proyecto:

```
generator/
  generate_service_menu.py   # generador (valida + escapa HTML, escribe HTML y QR SVG)
  templates/base.html        # template estructural único (mobile-first)
  styles/                    # 1 paleta CSS por estilo cerrado (6 archivos)
data/demos/                  # payloads dummy (1 por estilo: bella-spa, studio-blush,
                             #   north-barber, glow-nails, aqua-wellness, sage-studio)
public/index.html            # landing HMU Link por default (inglés, USD)
public/es/index.html         # landing HMU Link en español (México, MXN)
public/assets/previews/      # capturas reales de las 6 demos (usadas en ambas landings)
public/demos/                # salida generada (index.html + qr.svg por slug)
requirements.txt             # dependencia fijada (segno)
.github/workflows/           # generate-demos.yml (valida en push/PR)
                             # pages.yml (publica public/ a GitHub Pages en push a main)
```

## Documentación

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — qué es el producto, MVP, precios, límites.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) — modelo de datos y estados.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura técnica futura.
- [docs/SECURITY.md](docs/SECURITY.md) — reglas de seguridad y separación de MyGuest.
- [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) — checklist de calidad.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — operación manual día a día.
- [docs/ROADMAP.md](docs/ROADMAP.md) — fases de construcción del MVP.
