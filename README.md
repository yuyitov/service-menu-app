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

**Phase 1 — Generador HTML estático + demos dummy.**

Phase 0 (documentación y arquitectura) está aprobada. Phase 1 agrega un generador estático
que convierte un payload `service_menu_payload_public` (JSON dummy) en una página pública
mobile-first, en tres estilos cerrados: `clean`, `warm`, `premium`.

Todavía **no** hay Stripe, Tally, Cloudflare Worker/KV, GitHub Actions ni emails reales
(esas son fases posteriores). El QR se muestra como **placeholder**; el QR real se genera
en Phase 2/2B. Los uploads de imágenes están fuera de alcance de Phase 1: si faltan
`primary_image_url` / `logo_url`, el generador usa un placeholder visual.

Ver [docs/ROADMAP.md](docs/ROADMAP.md) para las fases siguientes.

## Cómo correr Phase 1

Requiere solo Python 3 (sin dependencias externas).

```bash
# Generar las 3 demos incluidas (data/demos/*.json) en public/demos/{slug}/index.html
python generator/generate_service_menu.py

# O generar payloads específicos
python generator/generate_service_menu.py data/demos/bella-spa.json
```

Salida: `public/demos/<slug>/index.html`. Abre cualquiera en el navegador (idealmente en
vista mobile) para revisarla. También puedes servir la carpeta localmente:

```bash
python -m http.server 8123 --directory public
# luego abre http://localhost:8123/demos/bella-spa/index.html
```

Estructura de Phase 1:

```
generator/
  generate_service_menu.py   # generador (stdlib, valida + escapa HTML)
  templates/                 # clean.html, warm.html, premium.html
data/demos/                  # payloads dummy (bella-spa, glow-nails, wellness-studio)
public/demos/                # salida generada (index.html por slug)
```

## Documentación

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — qué es el producto, MVP, precios, límites.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) — modelo de datos y estados.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura técnica futura.
- [docs/SECURITY.md](docs/SECURITY.md) — reglas de seguridad y separación de MyGuest.
- [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) — checklist de calidad.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — operación manual día a día.
- [docs/ROADMAP.md](docs/ROADMAP.md) — fases de construcción del MVP.
