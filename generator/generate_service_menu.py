#!/usr/bin/env python3
"""Service Menu App - static HTML + QR generator (Phase 2 demos + Phase 5 clients).

Reads `service_menu_payload_public` JSONs, validates the minimum required
fields, escapes all dynamic content, and renders mobile-first static pages
using one of twelve closed brand styles:
black-gold / soft-blush / charcoal-clean / warm-sand / aqua-clean / sage-calm /
electric-slate / terracotta-warm / sunny-paws / midnight-ink /
clarity-editorial / horizon-teal.

Two page kinds:

- **Demos** (`data/demos/*.json` -> `public/demos/<slug>/`): single-language
  Spanish pages, `noindex`, footer "HMU Link - Demo". Behavior unchanged from
  Phase 2.
- **Real clients** (`data/clients/*.json` -> `public/links/<slug>/`): bilingual
  pages (Spanish + English). The client's `default_language` renders at the
  root of the slug; the alternate language renders in a subfolder (`en/` or
  `es/`). Both carry static canonical + hreflang links and a language switch.
  One QR per client, at the root, encoding the default-language URL.
  Client JSONs must contain ONLY approved public business data (see
  docs/CLIENT_PUBLIC_DATA_CHECKLIST.md). Files starting with `_` are treated
  as templates and skipped.

Rendering uses a single shared structural template (templates/base.html) plus a
per-style palette file (styles/<brand_style>.css). Colors are never free-form:
only the twelve approved closed styles are accepted.

Scope note. This script still does NOT talk to Stripe, Tally, Cloudflare
Worker/KV or email, does NOT deploy to GitHub Pages, and does NOT download or
process user images. The QR is a static asset (not dynamic, no tracking, no
tokens). The only third-party dependency is `segno` (pure Python, QR -> SVG).

Usage:
    python generator/generate_service_menu.py                 # build all demos + all clients
    python generator/generate_service_menu.py a.json b.json   # build specific demo payloads
    python generator/generate_service_menu.py --client c.json # build specific client payloads
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
CLIENTS_DIR = REPO_ROOT / "data" / "clients"
CLIENT_OUTPUT_DIR = REPO_ROOT / "public" / "links"

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
# Phase 4E: demos are published on the custom domain (still no secrets and no private links).
DEMO_BASE_URL = "https://www.hmulink.com/demos"
# Phase 5: real client pages live under /links/, separate from /demos/.
CLIENT_BASE_URL = "https://www.hmulink.com/links"

CLIENT_LANGS = ("es", "en")

# Required top-level fields for a minimally valid public payload (demos).
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

# UI strings per language. The "es" strings are byte-for-byte the historical
# hardcoded labels so demo output stays identical (intentionally unaccented).
STRINGS = {
    "es": {
        "title_suffix": "Servicios",
        "btn_whatsapp": "Reservar por WhatsApp",
        "btn_phone": "Llamar",
        "btn_email": "Enviar correo",
        "btn_website": "Sitio web",
        "btn_booking": "Reservar en linea",
        "hero_placeholder": "Imagen del negocio",
        "services_title": "Servicios",
        "services_fallback": "Servicios",
        "featured_badge": "Destacado",
        "hours_title": "Horarios",
        "address_title": "Donde estamos",
        "address_map": "Ver en Google Maps",
        "policies_title": "Politicas",
        "share_title": "Comparte esta pagina",
        "share_lead": "Usa este QR o comparte el link directo.",
        "share_open": "Abrir pagina",
        "qr_alt": "Codigo QR de",
        "lang_switch": "View this page in English",
    },
    "en": {
        "title_suffix": "Services",
        "btn_whatsapp": "Book on WhatsApp",
        "btn_phone": "Call",
        "btn_email": "Send an email",
        "btn_website": "Website",
        "btn_booking": "Book online",
        "hero_placeholder": "Business image",
        "services_title": "Services",
        "services_fallback": "Services",
        "featured_badge": "Featured",
        "hours_title": "Hours",
        "address_title": "Where we are",
        "address_map": "View on Google Maps",
        "policies_title": "Policies",
        "share_title": "Share this page",
        "share_lead": "Use this QR code or share the direct link.",
        "share_open": "Open page",
        "qr_alt": "QR code for",
        "lang_switch": "Ver esta pagina en espanol",
    },
}


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


def tel_href(value):
    """Build a tel: link from a phone string (digits and leading + only)."""
    if not value:
        return None
    digits = re.sub(r"\D", "", str(value))
    if not digits:
        return None
    return f"tel:+{digits}"


def mailto_href(value):
    """Build a mailto: link from a plain email address (very light check)."""
    if not value:
        return None
    raw = str(value).strip()
    if "@" not in raw or " " in raw or raw.count("@") != 1:
        return None
    return "mailto:" + html.escape(raw, quote=True)


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


def validate_client(payload: dict) -> None:
    """Validate a bilingual real-client payload (client_payload_public v1)."""
    if not str(payload.get("public_slug", "")).strip():
        raise ValidationError("Cliente: falta public_slug.")
    if payload.get("default_language") not in CLIENT_LANGS:
        raise ValidationError("Cliente: default_language debe ser 'es' o 'en'.")
    if payload.get("brand_style") not in BRAND_STYLES:
        raise ValidationError(
            f"Cliente: brand_style invalido: {payload.get('brand_style')!r}."
        )
    if not str(payload.get("business_name", "")).strip():
        raise ValidationError("Cliente: falta business_name.")

    contact_keys = ("whatsapp", "phone", "public_email", "booking_url")
    if not any(str(payload.get(k, "") or "").strip() for k in contact_keys):
        raise ValidationError(
            "Cliente: se requiere al menos un contacto publico "
            "(whatsapp, phone, public_email o booking_url)."
        )

    content = payload.get("content")
    if not isinstance(content, dict):
        raise ValidationError("Cliente: falta el objeto content con 'es' y 'en'.")
    for lang in CLIENT_LANGS:
        block = content.get(lang)
        if not isinstance(block, dict):
            raise ValidationError(f"Cliente: falta content.{lang}.")
        for field in ("short_description", "opening_hours_text"):
            if not str(block.get(field, "")).strip():
                raise ValidationError(f"Cliente: falta content.{lang}.{field}.")
        services = block.get("services")
        if not isinstance(services, list) or len(services) == 0:
            raise ValidationError(
                f"Cliente: content.{lang}.services debe tener al menos un servicio."
            )
        for i, svc in enumerate(services):
            if not isinstance(svc, dict) or not str(svc.get("name", "")).strip():
                raise ValidationError(
                    f"Cliente: content.{lang}.services[{i}] requiere al menos 'name'."
                )


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


def build_hero(payload: dict, s: dict) -> str:
    href = safe_href(payload.get("primary_image_url"))
    alt = esc(payload.get("business_name"))
    if href:
        return f'<div class="hero"><img class="hero__img" src="{href}" alt="{alt}"></div>'
    # Placeholder hero: labeled gradient band, never a broken image.
    return (
        '<div class="hero hero--placeholder" role="img" '
        f'aria-label="{alt}"><span class="hero__ph-text">{s["hero_placeholder"]}</span></div>'
    )


def _button(href: str, css: str, label: str) -> str:
    return (
        f'<a class="btn {css}" href="{href}" target="_blank" '
        f'rel="noopener noreferrer">{label}</a>'
    )


def build_buttons(payload: dict, s: dict) -> str:
    buttons = []

    wa = whatsapp_href(payload.get("whatsapp"))
    if wa:
        buttons.append(_button(esc(wa), "btn--wa", s["btn_whatsapp"]))

    tel = tel_href(payload.get("phone"))
    if tel:
        buttons.append(f'<a class="btn btn--phone" href="{esc(tel)}">{s["btn_phone"]}</a>')

    booking = safe_href(payload.get("booking_url"))
    if booking:
        buttons.append(_button(booking, "btn--booking", s["btn_booking"]))

    ig = safe_href(payload.get("instagram"))
    if ig:
        buttons.append(_button(ig, "btn--ig", "Instagram"))

    fb = safe_href(payload.get("facebook"))
    if fb:
        buttons.append(_button(fb, "btn--fb", "Facebook"))

    tk = safe_href(payload.get("tiktok"))
    if tk:
        buttons.append(_button(tk, "btn--tiktok", "TikTok"))

    maps = safe_href(payload.get("google_maps_url"))
    if maps:
        buttons.append(_button(maps, "btn--maps", "Google Maps"))

    reviews = safe_href(payload.get("google_reviews_url"))
    if reviews:
        buttons.append(_button(reviews, "btn--reviews", "Google Reviews"))

    web = safe_href(payload.get("website"))
    if web:
        buttons.append(_button(web, "btn--web", s["btn_website"]))

    mail = mailto_href(payload.get("public_email"))
    if mail:
        buttons.append(f'<a class="btn btn--email" href="{mail}">{s["btn_email"]}</a>')

    return '<nav class="buttons">' + "".join(buttons) + "</nav>"


def build_services(payload: dict, s: dict) -> str:
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
        items = [svc for svc in services if svc.get("category") == cat]
        if not items:
            continue
        for item in items:
            used.add(id(item))
        rows = "".join(render_service(item) for item in items)
        blocks.append(
            f'<div class="svc-cat"><h3 class="svc-cat__title">{esc(cat)}</h3>'
            f'<ul class="svc-list">{rows}</ul></div>'
        )

    # Services without a (matching) category go under a generic group.
    leftovers = [svc for svc in services if id(svc) not in used]
    if leftovers:
        rows = "".join(render_service(svc) for svc in leftovers)
        blocks.append(
            f'<div class="svc-cat"><h3 class="svc-cat__title">{s["services_fallback"]}</h3>'
            f'<ul class="svc-list">{rows}</ul></div>'
        )

    return (
        '<section class="section" id="servicios">'
        f'<h2 class="section__title">{s["services_title"]}</h2>'
        + "".join(blocks)
        + "</section>"
    )


def build_featured(payload: dict, s: dict) -> str:
    pkg = payload.get("featured_package")
    if not isinstance(pkg, dict) or not str(pkg.get("name", "")).strip():
        return ""
    name = esc(pkg.get("name"))
    desc = esc(pkg.get("description"))
    price = pkg.get("price_label")
    price_html = f'<div class="featured__price">{esc(price)}</div>' if price else ""
    # Sin descripción (o igual al nombre) no se repite el texto.
    desc_html = f'<p class="featured__desc">{desc}</p>' if desc and desc != name else ""
    return (
        f'<section class="section featured"><div class="featured__badge">{s["featured_badge"]}</div>'
        f'<h2 class="featured__name">{name}</h2>'
        f'{desc_html}{price_html}</section>'
    )


def build_hours(payload: dict, s: dict) -> str:
    text = esc(payload.get("opening_hours_text"))
    return (
        f'<section class="section"><h2 class="section__title">{s["hours_title"]}</h2>'
        f'<p class="hours">{text}</p></section>'
    )


def _address_map_link(maps_url, s: dict) -> str:
    maps = safe_href(maps_url)
    if not maps:
        return ""
    return (
        f'<a class="address__map" href="{maps}" target="_blank" '
        f'rel="noopener noreferrer">{s["address_map"]}</a>'
    )


def build_address(payload: dict, s: dict) -> str:
    locations = payload.get("locations")
    if isinstance(locations, list) and len(locations) > 1:
        items = []
        for loc in locations:
            if not isinstance(loc, dict):
                continue
            addr = str(loc.get("address", "") or "").strip()
            if not addr:
                continue
            name = str(loc.get("name", "") or "").strip()
            name_html = f'<h3 class="address__name">{esc(name)}</h3>' if name else ""
            notes = str(loc.get("notes", "") or "").strip()
            notes_html = f'<p class="address__notes">{esc(notes)}</p>' if notes else ""
            link = _address_map_link(loc.get("google_maps_url"), s)
            items.append(
                f'<div class="address__item">{name_html}'
                f'<p class="address">{esc(addr)}</p>{notes_html}{link}</div>'
            )
        if not items:
            return ""
        return (
            f'<section class="section"><h2 class="section__title">{s["address_title"]}</h2>'
            f'{"".join(items)}</section>'
        )

    if not str(payload.get("address", "") or "").strip():
        return ""
    text = esc(payload.get("address"))
    link = _address_map_link(payload.get("google_maps_url"), s)
    return (
        f'<section class="section"><h2 class="section__title">{s["address_title"]}</h2>'
        f'<p class="address">{text}</p>{link}</section>'
    )


def build_policies(payload: dict, s: dict) -> str:
    policies = payload.get("policies") or []
    items = [f'<li>{esc(p)}</li>' for p in policies if str(p).strip()]
    if not items:
        return ""
    return (
        f'<section class="section"><h2 class="section__title">{s["policies_title"]}</h2>'
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


def build_share(public_url: str, s: dict, qr_src: str = QR_ASSET_NAME) -> str:
    """"Share this page" section: QR image + visible link.

    The QR references the static asset written next to the page (qr.svg) or at
    the client root (../qr.svg for alternate-language pages). No JavaScript,
    no external scripts, no tracking. No "open page" button: on the page
    itself it would just reload the same page.
    """
    href = safe_href(public_url)
    shown = esc(public_url)
    alt = esc(f"{s['qr_alt']} {public_url}")

    link_line = (
        f'<a class="link__url" href="{href}" target="_blank" rel="noopener noreferrer">{shown}</a>'
        if href
        else f'<span class="link__url">{shown}</span>'
    )
    return (
        '<section class="section qr" id="compartir">'
        f'<h2 class="section__title">{s["share_title"]}</h2>'
        f'<p class="qr__lead">{s["share_lead"]}</p>'
        f'<div class="qr__box"><img class="qr__img" src="{esc(qr_src)}" '
        f'alt="{alt}" width="180" height="180"></div>'
        f'<p class="qr__url-line">{link_line}</p>'
        "</section>"
    )


def build_footer(text: str = "HMU Link - Demo") -> str:
    return (
        '<footer class="footer">'
        f'{esc(text)}'
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


DEMO_HEAD_META = '<meta name="robots" content="noindex">'


def render_view(
    view: dict,
    lang: str,
    *,
    head_meta: str,
    lang_switch_html: str,
    footer_text: str,
    share_url: str,
    qr_src: str = QR_ASSET_NAME,
) -> str:
    """Render one page (any language) from a flat single-language view dict."""
    s = STRINGS[lang]
    brand = view["brand_style"]
    template_path = TEMPLATES_DIR / "base.html"
    if not template_path.exists():
        raise ValidationError(f"No existe el template base: {template_path}")
    style_path = STYLES_DIR / f"{brand}.css"
    if not style_path.exists():
        raise ValidationError(f"No existe el estilo para brand_style={brand!r}: {style_path}")
    template = template_path.read_text(encoding="utf-8")
    style_css = style_path.read_text(encoding="utf-8")

    tokens = {
        "{{LANG}}": lang,
        "{{HEAD_META}}": head_meta,
        "{{STYLE_NAME}}": esc(brand),
        "{{STYLE_CSS}}": style_css,
        "{{PAGE_TITLE}}": esc(f'{view.get("business_name")} - {s["title_suffix"]}'),
        "{{BUSINESS_NAME}}": esc(view.get("business_name")),
        "{{SHORT_DESCRIPTION}}": esc(view.get("short_description")),
        "{{LANG_SWITCH_BLOCK}}": lang_switch_html,
        "{{LOGO_BLOCK}}": build_logo(view),
        "{{HERO_BLOCK}}": build_hero(view, s),
        "{{BUTTONS_BLOCK}}": build_buttons(view, s),
        "{{FEATURED_BLOCK}}": build_featured(view, s),
        "{{SERVICES_BLOCK}}": build_services(view, s),
        "{{HOURS_BLOCK}}": build_hours(view, s),
        "{{ADDRESS_BLOCK}}": build_address(view, s),
        "{{POLICIES_BLOCK}}": build_policies(view, s),
        "{{SHARE_BLOCK}}": build_share(share_url, s, qr_src),
        "{{FOOTER_BLOCK}}": build_footer(footer_text),
    }

    out = template
    for token, value in tokens.items():
        out = out.replace(token, value)
    return out


def render(payload: dict) -> str:
    """Render a single-language Spanish demo page (Phase 2 behavior)."""
    validate(payload)
    return render_view(
        payload,
        "es",
        head_meta=DEMO_HEAD_META,
        lang_switch_html="",
        footer_text="HMU Link - Demo",
        share_url=resolve_public_url(payload),
    )


# --------------------------------------------------------------------------- #
# Client rendering (bilingual, Phase 5)
# --------------------------------------------------------------------------- #
def client_lang_view(payload: dict, lang: str) -> dict:
    """Flatten shared fields + per-language content into one render view."""
    view = {
        key: payload.get(key)
        for key in (
            "business_name",
            "brand_style",
            "logo_url",
            "primary_image_url",
            "whatsapp",
            "phone",
            "public_email",
            "instagram",
            "facebook",
            "tiktok",
            "website",
            "booking_url",
            "google_maps_url",
            "google_reviews_url",
            "locations",
        )
    }
    view.update(payload["content"][lang])
    return view


def client_head_meta(canonical: str, es_url: str, en_url: str, default_url: str) -> str:
    return (
        f'<link rel="canonical" href="{esc(canonical)}">\n'
        f'<link rel="alternate" hreflang="es" href="{esc(es_url)}">\n'
        f'<link rel="alternate" hreflang="en" href="{esc(en_url)}">\n'
        f'<link rel="alternate" hreflang="x-default" href="{esc(default_url)}">'
    )


def build_client(json_path: Path) -> Path:
    """Generate both language pages + one QR for a real client payload."""
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    validate_client(payload)

    slug = str(payload["public_slug"]).strip()
    default_lang = payload["default_language"]
    alt_lang = "en" if default_lang == "es" else "es"

    root_url = f"{CLIENT_BASE_URL}/{slug}/"
    alt_url = f"{root_url}{alt_lang}/"
    lang_urls = {default_lang: root_url, alt_lang: alt_url}

    root_dir = CLIENT_OUTPUT_DIR / slug
    root_dir.mkdir(parents=True, exist_ok=True)
    alt_dir = root_dir / alt_lang
    alt_dir.mkdir(parents=True, exist_ok=True)

    head = {
        lang: client_head_meta(
            lang_urls[lang], lang_urls.get("es"), lang_urls.get("en"), root_url
        )
        for lang in CLIENT_LANGS
    }
    # Language switch: default page links into the subfolder; the alternate
    # page links back to the client root. Labels come from the *target* page
    # language so the visitor reads the switch in the language they want.
    switch = {
        default_lang: (
            f'<div class="lang-switch"><a href="{alt_lang}/" lang="{alt_lang}">'
            f'{STRINGS[default_lang]["lang_switch"]}</a></div>'
        ),
        alt_lang: (
            f'<div class="lang-switch"><a href="../" lang="{default_lang}">'
            f'{STRINGS[alt_lang]["lang_switch"]}</a></div>'
        ),
    }

    default_html = render_view(
        client_lang_view(payload, default_lang),
        default_lang,
        head_meta=head[default_lang],
        lang_switch_html=switch[default_lang],
        footer_text="HMU Link",
        share_url=root_url,
        qr_src=QR_ASSET_NAME,
    )
    alt_html = render_view(
        client_lang_view(payload, alt_lang),
        alt_lang,
        head_meta=head[alt_lang],
        lang_switch_html=switch[alt_lang],
        footer_text="HMU Link",
        share_url=root_url,
        qr_src=f"../{QR_ASSET_NAME}",
    )

    (root_dir / "index.html").write_text(default_html, encoding="utf-8")
    (alt_dir / "index.html").write_text(alt_html, encoding="utf-8")
    # One QR per client, encoding the default-language URL.
    (root_dir / QR_ASSET_NAME).write_text(make_qr_svg(root_url), encoding="utf-8")
    return root_dir / "index.html"


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


def _client_jsons() -> list[Path]:
    """Client payloads to build: data/clients/*.json, skipping _templates."""
    if not CLIENTS_DIR.exists():
        return []
    return sorted(
        p for p in CLIENTS_DIR.glob("*.json") if not p.name.startswith("_")
    )


def main(argv: list[str]) -> int:
    demo_paths: list[Path] = []
    client_paths: list[Path] = []

    if argv:
        as_client = False
        for arg in argv:
            if arg == "--client":
                as_client = True
                continue
            (client_paths if as_client else demo_paths).append(Path(arg))
    else:
        demo_paths = sorted(DEMOS_DIR.glob("*.json"))
        client_paths = _client_jsons()

    if not demo_paths and not client_paths:
        print("No se encontraron payloads JSON para generar.", file=sys.stderr)
        return 1

    failures = 0
    for path in demo_paths:
        try:
            out_file = build_one(path)
            rel = out_file.relative_to(REPO_ROOT)
            print(f"[ok]   {path.name} -> {rel}")
        except (ValidationError, json.JSONDecodeError, OSError) as exc:
            failures += 1
            print(f"[fail] {path.name}: {exc}", file=sys.stderr)

    for path in client_paths:
        try:
            out_file = build_client(path)
            rel = out_file.relative_to(REPO_ROOT)
            print(f"[ok]   {path.name} -> {rel} (+ alterno bilingue)")
        except (ValidationError, json.JSONDecodeError, OSError) as exc:
            failures += 1
            print(f"[fail] {path.name}: {exc}", file=sys.stderr)

    total = len(demo_paths) + len(client_paths)
    print(f"\nGeneradas {total - failures}/{total} paginas.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
