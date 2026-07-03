#!/usr/bin/env python3
"""Service Menu App - Phase 1 static HTML generator.

Reads a dummy `service_menu_payload_public` JSON, validates the minimum
required fields, escapes all dynamic content, and renders a mobile-first
static page using one of three closed brand styles: clean / warm / premium.

Phase 1 scope only. This script:
  - does NOT talk to Stripe, Tally, Cloudflare Worker/KV, GitHub Actions or email.
  - does NOT download or process images (there is no Worker in Phase 1).
  - uses ONLY the Python standard library (no external dependencies).
  - renders a clear QR placeholder; real QR generation is deferred to Phase 2/2B.

Usage:
    python generator/generate_service_menu.py               # build all demos in data/demos/
    python generator/generate_service_menu.py a.json b.json # build specific payloads
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

# Repo layout (this file lives in <repo>/generator/).
REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
DEMOS_DIR = REPO_ROOT / "data" / "demos"
OUTPUT_DIR = REPO_ROOT / "public" / "demos"

BRAND_STYLES = ("clean", "warm", "premium")

# Fallback base URL used only if a demo payload omits `public_url`.
# Intentionally a dummy/demo host - no private or real links in Phase 1.
DEMO_BASE_URL = "https://demo.servicemenu.example"

# Required top-level fields for a minimally valid public payload.
REQUIRED_FIELDS = (
    "public_slug",
    "business_name",
    "short_description",
    "brand_style",
    "whatsapp",
    "google_maps_url",
    "address",
    "opening_hours_text",
)

# URL schemes we are willing to emit into href attributes.
_ALLOWED_SCHEMES = ("http://", "https://")


class ValidationError(ValueError):
    """Raised when a payload is missing or has invalid required fields."""


# --------------------------------------------------------------------------- #
# Escaping / sanitizing helpers
# --------------------------------------------------------------------------- #
def esc(value) -> str:
    """HTML-escape text content and attribute values (quote-safe)."""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def safe_href(value):
    """Return an escaped http(s) URL, or None if the value is unsafe/empty.

    Only http/https are allowed. Anything else (javascript:, data:, empty)
    is rejected so we never emit an unsafe link into the page.
    """
    if not value:
        return None
    raw = str(value).strip()
    if not raw.lower().startswith(_ALLOWED_SCHEMES):
        return None
    return html.escape(raw, quote=True)


def whatsapp_href(value):
    """Build a wa.me link from a phone string, keeping only digits."""
    if not value:
        return None
    digits = re.sub(r"\D", "", str(value))
    if not digits:
        return None
    return f"https://wa.me/{digits}"


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def validate(payload: dict) -> None:
    """Validate minimum required fields. Raises ValidationError with a clear message."""
    missing = [
        field
        for field in REQUIRED_FIELDS
        if not str(payload.get(field, "")).strip()
    ]
    if missing:
        raise ValidationError(
            "Faltan campos requeridos o estan vacios: " + ", ".join(missing)
        )

    brand = payload.get("brand_style")
    if brand not in BRAND_STYLES:
        raise ValidationError(
            f"brand_style invalido: {brand!r}. Debe ser uno de {BRAND_STYLES}."
        )

    services = payload.get("services")
    if not isinstance(services, list) or len(services) == 0:
        raise ValidationError("services debe ser una lista con al menos un servicio.")

    for i, svc in enumerate(services):
        if not isinstance(svc, dict) or not str(svc.get("name", "")).strip():
            raise ValidationError(f"services[{i}] requiere al menos 'name'.")


# --------------------------------------------------------------------------- #
# HTML fragment builders (all dynamic values are escaped here)
# --------------------------------------------------------------------------- #
def _initials(business_name: str) -> str:
    parts = [p for p in re.split(r"\s+", business_name.strip()) if p]
    letters = "".join(p[0] for p in parts[:2])
    return esc(letters.upper() or "?")


def build_logo(payload: dict) -> str:
    href = safe_href(payload.get("logo_url"))
    alt = esc(payload.get("business_name"))
    if href:
        return f'<img class="logo" src="{href}" alt="{alt}">'
    # Placeholder logo: initials in a circle (no external image needed).
    return f'<div class="logo logo--placeholder" aria-hidden="true">{_initials(str(payload.get("business_name", "")))}</div>'


def build_hero(payload: dict) -> str:
    href = safe_href(payload.get("primary_image_url"))
    alt = esc(payload.get("business_name"))
    if href:
        return f'<div class="hero"><img class="hero__img" src="{href}" alt="{alt}"></div>'
    # Placeholder hero: labeled gradient band, never a broken image.
    return (
        '<div class="hero hero--placeholder" role="img" '
        f'aria-label="{alt}"><span class="hero__ph-text">Imagen del negocio</span></div>'
    )


def build_buttons(payload: dict) -> str:
    buttons = []

    wa = whatsapp_href(payload.get("whatsapp"))
    if wa:
        buttons.append(
            f'<a class="btn btn--wa" href="{esc(wa)}" target="_blank" '
            'rel="noopener noreferrer">WhatsApp</a>'
        )

    ig = safe_href(payload.get("instagram"))
    if ig:
        buttons.append(
            f'<a class="btn btn--ig" href="{ig}" target="_blank" '
            'rel="noopener noreferrer">Instagram</a>'
        )

    maps = safe_href(payload.get("google_maps_url"))
    if maps:
        buttons.append(
            f'<a class="btn btn--maps" href="{maps}" target="_blank" '
            'rel="noopener noreferrer">Google Maps</a>'
        )

    reviews = safe_href(payload.get("google_reviews_url"))
    if reviews:
        buttons.append(
            f'<a class="btn btn--reviews" href="{reviews}" target="_blank" '
            'rel="noopener noreferrer">Google Reviews</a>'
        )

    return '<nav class="buttons">' + "".join(buttons) + "</nav>"


def build_services(payload: dict) -> str:
    services = payload.get("services") or []
    declared = payload.get("service_categories") or []

    # Preserve declared category order, then append any leftover categories.
    order = list(declared)
    for svc in services:
        cat = svc.get("category")
        if cat and cat not in order:
            order.append(cat)

    def render_service(svc: dict) -> str:
        name = esc(svc.get("name"))
        desc = svc.get("description")
        price = svc.get("price_label")
        parts = [f'<div class="svc__row"><span class="svc__name">{name}</span>']
        if price:
            parts.append(f'<span class="svc__price">{esc(price)}</span>')
        parts.append("</div>")
        if desc:
            parts.append(f'<p class="svc__desc">{esc(desc)}</p>')
        return f'<li class="svc">{"".join(parts)}</li>'

    blocks = []
    used = set()
    for cat in order:
        items = [s for s in services if s.get("category") == cat]
        if not items:
            continue
        for s in items:
            used.add(id(s))
        rows = "".join(render_service(s) for s in items)
        blocks.append(
            f'<div class="svc-cat"><h3 class="svc-cat__title">{esc(cat)}</h3>'
            f'<ul class="svc-list">{rows}</ul></div>'
        )

    # Services without a (matching) category go under a generic group.
    leftovers = [s for s in services if id(s) not in used]
    if leftovers:
        rows = "".join(render_service(s) for s in leftovers)
        blocks.append(
            '<div class="svc-cat"><h3 class="svc-cat__title">Servicios</h3>'
            f'<ul class="svc-list">{rows}</ul></div>'
        )

    return (
        '<section class="section" id="servicios">'
        '<h2 class="section__title">Servicios</h2>'
        + "".join(blocks)
        + "</section>"
    )


def build_featured(payload: dict) -> str:
    pkg = payload.get("featured_package")
    if not isinstance(pkg, dict) or not str(pkg.get("name", "")).strip():
        return ""
    name = esc(pkg.get("name"))
    desc = esc(pkg.get("description"))
    price = pkg.get("price_label")
    price_html = f'<div class="featured__price">{esc(price)}</div>' if price else ""
    return (
        '<section class="section featured"><div class="featured__badge">Destacado</div>'
        f'<h2 class="featured__name">{name}</h2>'
        f'<p class="featured__desc">{desc}</p>{price_html}</section>'
    )


def build_hours(payload: dict) -> str:
    text = esc(payload.get("opening_hours_text"))
    return (
        '<section class="section"><h2 class="section__title">Horarios</h2>'
        f'<p class="hours">{text}</p></section>'
    )


def build_address(payload: dict) -> str:
    text = esc(payload.get("address"))
    maps = safe_href(payload.get("google_maps_url"))
    link = (
        f'<a class="address__map" href="{maps}" target="_blank" '
        'rel="noopener noreferrer">Ver en Google Maps</a>'
        if maps
        else ""
    )
    return (
        '<section class="section"><h2 class="section__title">Donde estamos</h2>'
        f'<p class="address">{text}</p>{link}</section>'
    )


def build_policies(payload: dict) -> str:
    policies = payload.get("policies") or []
    items = [f'<li>{esc(p)}</li>' for p in policies if str(p).strip()]
    if not items:
        return ""
    return (
        '<section class="section"><h2 class="section__title">Politicas</h2>'
        f'<ul class="policies">{"".join(items)}</ul></section>'
    )


def build_qr(public_url: str) -> str:
    """QR Kit block.

    Phase 1 renders a *placeholder* QR (no external dependency added just to
    encode a QR). Real scannable QR generation is deferred to Phase 2 / 2B,
    where it will be produced as a static asset by GitHub Actions.
    """
    url = esc(public_url)
    return (
        '<section class="section qr" id="qr-kit">'
        '<h2 class="section__title">QR Kit</h2>'
        '<div class="qr__box" role="img" aria-label="Codigo QR (placeholder)">'
        '<div class="qr__grid" aria-hidden="true"></div>'
        '<span class="qr__label">QR placeholder</span></div>'
        f'<p class="qr__note">El QR real (escaneable, descargable) se genera en Phase 2/2B. '
        f'Apuntara a: <br><span class="qr__url">{url}</span></p>'
        "</section>"
    )


def build_link(public_url: str) -> str:
    href = safe_href(public_url)
    shown = esc(public_url)
    if href:
        link = f'<a class="link__url" href="{href}" target="_blank" rel="noopener noreferrer">{shown}</a>'
    else:
        link = f'<span class="link__url">{shown}</span>'
    return (
        '<section class="section link"><h2 class="section__title">Tu link</h2>'
        f'{link}</section>'
    )


def build_footer() -> str:
    return (
        '<footer class="footer">'
        'Pagina creada con Service Menu App - Demo (Phase 1)'
        "</footer>"
    )


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def resolve_public_url(payload: dict) -> str:
    url = str(payload.get("public_url", "")).strip()
    if url:
        return url
    slug = str(payload.get("public_slug", "")).strip()
    return f"{DEMO_BASE_URL}/{slug}"


def render(payload: dict) -> str:
    validate(payload)

    brand = payload["brand_style"]
    template_path = TEMPLATES_DIR / f"{brand}.html"
    if not template_path.exists():
        raise ValidationError(f"No existe template para brand_style={brand!r}: {template_path}")
    template = template_path.read_text(encoding="utf-8")

    public_url = resolve_public_url(payload)

    tokens = {
        "{{LANG}}": "es",
        "{{PAGE_TITLE}}": esc(f'{payload.get("business_name")} - Servicios'),
        "{{BUSINESS_NAME}}": esc(payload.get("business_name")),
        "{{SHORT_DESCRIPTION}}": esc(payload.get("short_description")),
        "{{LOGO_BLOCK}}": build_logo(payload),
        "{{HERO_BLOCK}}": build_hero(payload),
        "{{BUTTONS_BLOCK}}": build_buttons(payload),
        "{{FEATURED_BLOCK}}": build_featured(payload),
        "{{SERVICES_BLOCK}}": build_services(payload),
        "{{HOURS_BLOCK}}": build_hours(payload),
        "{{ADDRESS_BLOCK}}": build_address(payload),
        "{{POLICIES_BLOCK}}": build_policies(payload),
        "{{QR_BLOCK}}": build_qr(public_url),
        "{{LINK_BLOCK}}": build_link(public_url),
        "{{FOOTER_BLOCK}}": build_footer(),
    }

    out = template
    for token, value in tokens.items():
        out = out.replace(token, value)
    return out


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_one(json_path: Path) -> Path:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    slug = str(payload.get("public_slug", "")).strip() or json_path.stem
    html_out = render(payload)
    out_dir = OUTPUT_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(html_out, encoding="utf-8")
    return out_file


def main(argv: list[str]) -> int:
    if argv:
        paths = [Path(a) for a in argv]
    else:
        paths = sorted(DEMOS_DIR.glob("*.json"))

    if not paths:
        print("No se encontraron payloads JSON para generar.", file=sys.stderr)
        return 1

    failures = 0
    for path in paths:
        try:
            out_file = build_one(path)
            rel = out_file.relative_to(REPO_ROOT)
            print(f"[ok]   {path.name} -> {rel}")
        except (ValidationError, json.JSONDecodeError, OSError) as exc:
            failures += 1
            print(f"[fail] {path.name}: {exc}", file=sys.stderr)

    print(f"\nGeneradas {len(paths) - failures}/{len(paths)} paginas.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
