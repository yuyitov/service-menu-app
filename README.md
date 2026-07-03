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

**Phase 4C — Marca HMU Link, landings por mercado y dominio custom en preparación.**

La landing pública usa la marca provisional **HMU Link** y está dividida por mercado:

| Ruta | Contenido |
|---|---|
| `/` (`public/index.html`) | Portada/selector de mercado (México / USA-Canadá), sin geolocalización ni JS |
| `/mx/` (`public/mx/index.html`) | Página comercial para México, en español, WhatsApp-first, precios MXN |
| `/us/` (`public/us/index.html`) | Página comercial para USA/Canadá, en inglés, precios USD |

Las tres páginas son HTML/CSS puro: sin JavaScript, sin fonts ni imágenes externas, sin
analytics y sin formularios reales. Los precios mostrados son **de lanzamiento y
tentativos**; el checkout no está activo.

**Dominio custom:** se compró `hmulink.com` en Cloudflare. El dominio principal será
`www.hmulink.com` (apex redirigiendo a www). **Aún no está activo**: falta crear los
registros DNS en Cloudflare y configurar el custom domain en GitHub Pages (ver
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#dominio-custom-hmulinkcom-phase-4c)). Mientras
tanto todo se sirve desde `https://yuyitov.github.io/service-menu-app/` y los QR de las
demos siguen apuntando a esas URLs.

Phase 0 (documentación) y Phase 1 (generador + 6 estilos) están aprobadas. El generador
convierte un payload `service_menu_payload_public` (JSON dummy) en una página pública
mobile-first, en **6 estilos visuales cerrados**: `black-gold`, `soft-blush`,
`charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`. Sin colores libres; la
personalización es siempre por estilo cerrado.

Phase 2 agrega un **QR real estático** (`qr.svg`) por demo, apuntando al `public_url`, más
una sección "Comparte esta página" (QR + link visible + botón "Abrir página"). Un workflow
de GitHub Actions **valida** la generación de las 6 demos en cada push/PR.

Phase 3A conectó el repo a GitHub (`yuyitov/service-menu-app`) y validó el workflow de CI.
Phase 3B publica la carpeta `public/` en **GitHub Pages** vía un workflow dedicado
(`pages.yml`), sin secrets. Los `public_url` de las demos y sus QR apuntan a las URLs
públicas reales.

Todavía **no** hay Stripe, Tally, Cloudflare Worker/KV, emails reales, dashboard, login ni
dominio custom (fases posteriores). Los uploads de imágenes siguen fuera de alcance: si
faltan `primary_image_url` / `logo_url`, el generador usa un placeholder visual.

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para las fases siguientes.

## Demos públicas (GitHub Pages)

Base: `https://yuyitov.github.io/service-menu-app/`

| Demo | URL pública |
|---|---|
| Bella Spa | https://yuyitov.github.io/service-menu-app/demos/bella-spa/ |
| Studio Blush | https://yuyitov.github.io/service-menu-app/demos/studio-blush/ |
| North Barber | https://yuyitov.github.io/service-menu-app/demos/north-barber/ |
| Glow Nails | https://yuyitov.github.io/service-menu-app/demos/glow-nails/ |
| Aqua Wellness | https://yuyitov.github.io/service-menu-app/demos/aqua-wellness/ |
| Sage Studio | https://yuyitov.github.io/service-menu-app/demos/sage-studio/ |

El QR de cada demo está en `.../demos/<slug>/qr.svg` y codifica la URL pública de esa demo.

Para probar Pages: haz push a `main`, espera a que el workflow `pages` termine en la
pestaña Actions, y abre cualquiera de las URLs de la tabla (o escanea el QR desde la
sección "Comparte esta página").

## Cómo correr el generador

Requiere Python 3 y una dependencia ligera (`segno`, Python puro, para el QR SVG).

```bash
# 1) Instalar dependencias
pip install -r requirements.txt

# 2) Generar las 6 demos (data/demos/*.json) en public/demos/{slug}/
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
public/index.html            # portada/selector de mercado HMU Link (sin JS)
public/mx/index.html         # landing comercial México (español, MXN)
public/us/index.html         # landing comercial USA/Canadá (inglés, USD)
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
