#!/usr/bin/env python3
"""Service Menu App - static HTML + QR generator (Phase 2).

Reads a dummy `service_menu_payload_public` JSON, validates the minimum
required fields, escapes all dynamic content, and renders a mobile-first
static page using one of twelve closed brand styles:
black-gold / soft-blush / charcoal-clean / warm-sand / aqua-clean / sage-calm /
electric-slate / terracotta-warm / sunny-paws / midnight-ink /
clarity-editorial / horizon-teal.

Rendering uses a single shared structural template (templates/base.html) plus a
per-style palette file (styles/<brand_style>.css). Colors are never free-form:
only the twelve approved closed styles are accepted.

For each demo it also writes a real, static, scannable QR code as SVG next to the
page (public/demos/<slug>/qr.svg) pointing at the payload's public_url.

Scope note. This script still does NOT talk to Stripe, Tally, Cloudflare
Worker/KV or email, does NOT deploy to GitHub Pages, and does NOT download or
process user images. The QR is a static asset (not dynamic, no tracking, no
tokens). The only third-party dependency is `segno` (pure Python, QR -> SVG).

Usage:
    python generator/generate_service_menu.py               # build all demos in data/demos/
    python generator/generate_service_menu.py a.json b.json # build specific payloads
"""

from __future__ import annotations

import html
import io
import json
import re
import sys
from pathlib import Path

try:
    import segno
except ImportError:  # pragma: no cover - clear guidance if dependency missing
    segno = None

# Repo layout (this file lives in <repo>/generator/).
REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
STYLES_DIR = Path(__file__).resolve().parent / "styles"
DEMOS_DIR = REPO_ROOT / "data" / "demos"
OUTPUT_DIR = REPO_ROOT / "public" / "demos"

# The twelve approved closed visual styles. Colors are NOT free-form; a payload
# must pick exactly one of these. Each has a matching styles/<name>.css palette.
BRAND_STYLES = (
    "black-gold",
    "soft-blush",
    "charcoal-clean",
    "warm-sand",
    "aqua-clean",
    "sage-calm",
    "electric-slate",
    "terracotta-warm",
    "sunny-paws",
    "midnight-ink",
    "clarity-editorial",
    "horizon-teal",
)

# Fallback base URL used only if a demo payload omits `public_url`.
# Phase 3B: demos are published on GitHub Pages, so the fallback mirrors
# the real public base (still no secrets and no private links).
DEMO_BASE_URL = "https://yuyitov.github.io/service-menu-app/demos"

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
            'rel="noopener noreferrer">Reservar por WhatsApp</a>'
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


QR_ASSET_NAME = "qr.svg"


def make_qr_svg(public_url: str) -> str:
    """Return a scannable QR code as a STANDALONE SVG document encoding `public_url`.

    Uses segno (pure Python, no image libraries) via `save(kind="svg")`, which
    emits a proper standalone SVG (XML declaration + `xmlns`). This is required
    so the file works both when opened directly and when loaded as an external
    image via `<img src="qr.svg">` (segno's `svg_inline` omits the namespace and
    is only valid when embedded inline in HTML — that produced the broken image).

    Dark modules on a solid white background for high contrast on every style,
    including the dark black-gold theme.
    """
    if segno is None:
        raise ValidationError(
            "Falta la dependencia 'segno' para generar el QR. "
            "Instala con: pip install -r requirements.txt"
        )
    qr = segno.make(public_url, error="m")
    buff = io.BytesIO()
    # save(kind="svg") -> standalone SVG (xmldecl + svgns default True).
    qr.save(buff, kind="svg", scale=4, border=2, dark="#111111", light="#ffffff")
    return buff.getvalue().decode("utf-8")


def build_share(public_url: str) -> str:
    """"Comparte esta pagina" section: QR image + visible link + open button.

    The QR references the static asset written next to the page (qr.svg). No
    JavaScript, no external scripts, no tracking.
    """
    href = safe_href(public_url)
    shown = esc(public_url)
    alt = esc(f"Codigo QR de {public_url}")

    link_line = (
        f'<a class="link__url" href="{href}" target="_blank" rel="noopener noreferrer">{shown}</a>'
        if href
        else f'<span class="link__url">{shown}</span>'
    )
    open_btn = (
        f'<a class="btn btn--wa qr__open" href="{href}" target="_blank" '
        'rel="noopener noreferrer">Abrir pagina</a>'
        if href
        else ""
    )
    return (
        '<section class="section qr" id="compartir">'
        '<h2 class="section__title">Comparte esta pagina</h2>'
        '<p class="qr__lead">Usa este QR o comparte el link directo.</p>'
        f'<div class="qr__box"><img class="qr__img" src="{esc(QR_ASSET_NAME)}" '
        f'alt="{alt}" width="180" height="180"></div>'
        f'<p class="qr__url-line">{link_line}</p>'
        f'{open_btn}'
        "</section>"
    )


def build_footer() -> str:
    return (
        '<footer class="footer">'
        'Pagina creada con Service Menu App - Demo'
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
    template_path = TEMPLATES_DIR / "base.html"
    if not template_path.exists():
        raise ValidationError(f"No existe el template base: {template_path}")
    style_path = STYLES_DIR / f"{brand}.css"
    if not style_path.exists():
        raise ValidationError(f"No existe el estilo para brand_style={brand!r}: {style_path}")
    template = template_path.read_text(encoding="utf-8")
    style_css = style_path.read_text(encoding="utf-8")

    public_url = resolve_public_url(payload)

    tokens = {
        "{{LANG}}": "es",
        "{{STYLE_NAME}}": esc(brand),
        "{{STYLE_CSS}}": style_css,
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
        "{{SHARE_BLOCK}}": build_share(public_url),
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
    qr_svg = make_qr_svg(resolve_public_url(payload))

    out_dir = OUTPUT_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(html_out, encoding="utf-8")
    (out_dir / QR_ASSET_NAME).write_text(qr_svg, encoding="utf-8")
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
