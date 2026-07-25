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

## Flujo de automatización (en producción)

```
Stripe Payment Link (LIVE)
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
incluida vía un link de un solo uso (página `/correct/` → worker → Actions aplica los
cambios con gpt-4o-mini y regenera; si no puede con seguridad, cae a manual). Las
correcciones adicionales ($6 USD / $59 MXN) se compran vía `/buy-correction` (Stripe
Checkout creado por el worker).

## Estado actual

**Phases 6-9 — Pipeline automatizado en producción, Stripe LIVE, vendiendo.**

El flujo completo está desplegado y probado end-to-end con clientes reales: Stripe
Payment Link en modo **LIVE** → email post-pago → intake en Tally → Cloudflare Worker →
GitHub Actions → GitHub Pages → email de entrega con link + QR → 1 corrección incluida
(auto-aplicada vía gpt-4o-mini, con fallback manual) → correcciones adicionales de pago.

Precios vigentes: **$49 USD / $799 MXN** (precio de lanzamiento, tachado el precio de
lista $79 USD / $1,299 MXN), pago único. 1 corrección gratis incluida; correcciones
adicionales $6 USD / $59 MXN cada una.

- CTAs primarios de ambas landings (`/` y `/es/`) abren directamente el Stripe Payment
  Link correspondiente a su mercado (USD / MXN).
- Dominio custom `https://www.hmulink.com` completamente migrado: GitHub Pages con
  custom domain, Cloudflare DNS (CNAME + apex), HTTPS activo, `public/CNAME`.
- Logo final integrado como asset: `public/assets/brand/hmu-link-logo.png` (lockup
  completo, usado como `og:image`), recortado en `mascot-96.png`/`mascot-480.png` para
  el mascot del header/footer y en `favicon-64.png`/`favicon-180.png` para favicons —
  el wordmark "HMU"/"Link" del header/footer se renderiza en HTML/CSS (con los mismos
  colores de marca) por accesibilidad y nitidez en cualquier densidad de pantalla.

Las dos páginas públicas (`/`, `/es/`) usan la identidad visual oficial de HMU
Link: paleta Bubblegum `#f478b0` / Tangerine `#ffa934` / Ocean Blue `#00a0b5` / Banana
`#ffef5a` / Avocado `#98c54e` / Bell Pepper `#14704f`, estilo playful + limpio +
profesional, botones redondeados y blobs decorativos en CSS.

La landing pública usa la marca **HMU Link** y está dividida por idioma
(no hay selector intermedio; cada idioma es directamente su página):

| Ruta | Contenido |
|---|---|
| `/` (`public/index.html`) | Landing por default, en inglés, precios USD (mercado USA/Canadá) |
| `/es/` (`public/es/index.html`) | Landing en español, precios MXN, WhatsApp-first (mercado México) |

Un botón de idioma en el header/footer navega entre ambas.

El generador convierte tanto payloads dummy (`data/demos/`) como clientes reales
(`data/clients/<slug>.client.json`) en páginas mobile-first, en **12 estilos visuales
cerrados**: `black-gold`, `soft-blush`, `charcoal-clean`, `warm-sand`, `aqua-clean`,
`sage-calm`, `electric-slate`, `terracotta-warm`, `sunny-paws`, `midnight-ink`,
`clarity-editorial`, `horizon-teal`. Sin colores libres; la personalización es siempre
por estilo cerrado. Cada página incluye un **QR real estático** (`qr.svg`) apuntando al
`public_url`. Un workflow de GitHub Actions valida la generación de las demos en cada
push/PR, y `pages.yml` publica `public/` a GitHub Pages.

Los uploads de imágenes siguen fuera de alcance: si faltan `primary_image_url` /
`logo_url`, el generador usa un placeholder visual.

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para el historial completo de fases.

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
