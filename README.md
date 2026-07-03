# Service Menu App

## Qué es

Service Menu App es un producto que genera **páginas digitales de servicios** para salones,
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

**Phase 2 — QR estático + GitHub Actions (validación).**

Phase 0 (documentación) y Phase 1 (generador + 6 estilos) están aprobadas. El generador
convierte un payload `service_menu_payload_public` (JSON dummy) en una página pública
mobile-first, en **6 estilos visuales cerrados**: `black-gold`, `soft-blush`,
`charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`. Sin colores libres; la
personalización es siempre por estilo cerrado.

Phase 2 agrega un **QR real estático** (`qr.svg`) por demo, apuntando al `public_url`, más
una sección "Comparte esta página" (QR + link visible + botón "Abrir página"). Un workflow
de GitHub Actions **valida** la generación de las 6 demos en cada push/PR.

Todavía **no** hay Stripe, Tally, Cloudflare Worker/KV ni emails reales, y **no** se
publica a GitHub Pages (fases posteriores). Los uploads de imágenes siguen fuera de
alcance: si faltan `primary_image_url` / `logo_url`, el generador usa un placeholder visual.

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para las fases siguientes.

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
public/demos/                # salida generada (index.html + qr.svg por slug)
requirements.txt             # dependencia fijada (segno)
.github/workflows/           # generate-demos.yml (valida la generación en push/PR)
```

## Documentación

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — qué es el producto, MVP, precios, límites.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) — modelo de datos y estados.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura técnica futura.
- [docs/SECURITY.md](docs/SECURITY.md) — reglas de seguridad y separación de MyGuest.
- [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) — checklist de calidad.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — operación manual día a día.
- [docs/ROADMAP.md](docs/ROADMAP.md) — fases de construcción del MVP.
