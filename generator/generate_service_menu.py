#!/usr/bin/env python3
"""Service Menu App - static HTML + QR generator (Phase 2 demos + Phase 5 clients).

Reads `service_menu_payload_public` JSONs, validates the minimum required
fields, escapes all dynamic content, and renders mobile-first static pages
using one of twelve closed brand styles:
black-gold / soft-blush / charcoal-clean / warm-sand / aqua-clean / sage-calm /
electric-slate / terracotta-warm / sunny-paws / midnight-ink /
clarity-editorial / horizon-teal.

Two page kinds:

- **Demos** (`data/demos/*.json` -> `public/demos/<slug>/`): bilingual pages
  (Spanish at the slug root, English in `en/`), `noindex`, footer
  "HMU Link - Demo", with a language switch. Being noindex, they carry no
  canonical/hreflang.
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
import unicodedata
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

# URL schemes we are willing to emit into href attributes.
_ALLOWED_SCHEMES = ("http://", "https://")
PRIMARY_CTA_CHOICES = ("whatsapp", "phone", "booking", "website", "tiktok", "email", "other", "maps")
DELIVERY_PICKUP_TYPES = {"food", "retail"}
PORTFOLIO_TYPES = {"creative", "beauty", "wellness", "professional", "fitness"}

# UI strings per language (WOW editorial template). Values marked *_html may
# contain trusted inline markup (<em>) and are injected without re-escaping.
STRINGS = {
    "es": {
        "title_suffix": "Servicios",
        "btn_whatsapp": "Reservar por WhatsApp",
        "btn_phone": "Llamar",
        "btn_email": "Enviar correo",
        "btn_website": "Sitio web",
        "btn_booking": "Reservar en linea",
        "btn_maps": "Google Maps",
        "btn_other": "Abrir enlace",
        "gallery_prev": "Foto anterior",
        "gallery_next": "Foto siguiente",
        "gallery_photo": "Foto",
        "delivery_pickup_label": "Entrega / recoger",
        "portfolio_label": "Portafolio",
        "view_menu": "Ver servicios",
        "scroll_hint": "Desliza",
        "skip_to_content": "Saltar al contenido",
        "services_eyebrow": "Servicios",
        "menu_title_html": "Nuestros <em>servicios</em>",
        "services_fallback": "Servicios",
        "price_ask": "Consultar",
        "featured_badge": "Destacado",
        "visit_eyebrow": "Detalles",
        "visit_title_html": "Planea tu <em>visita</em>",
        "hours_title": "Horarios",
        "client_care_title": "Atencion",
        "reservations_title": "Reservaciones",
        "address_title": "Dónde estamos",
        "address_map": "Ver en Google Maps",
        "location_label": "Ubicacion",
        "service_area_title": "Area de servicio",
        "class_schedule_title": "Horario de clases",
        "tour_details_title": "Sobre la experiencia",
        "pet_notes_title": "Antes de tu visita",
        "policies_title": "Políticas",
        "links_title": "Enlaces",
        "faq_eyebrow": "FAQ",
        "faq_title_html": "Preguntas <em>frecuentes</em>",
        "share_eyebrow": "Comparte",
        "share_title_html": "Llévanos <em>contigo</em>",
        "share_lead": "Escanea el código o comparte el link directo.",
        "share_button": "Compartir link",
        "share_copied": "Link copiado",
        "footer_credit": "Hecho con HMU Link",
        "footer_demo_credit": "Demo hecho con HMU Link",
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
        "btn_maps": "Google Maps",
        "btn_other": "Open link",
        "gallery_prev": "Previous photo",
        "gallery_next": "Next photo",
        "gallery_photo": "Photo",
        "delivery_pickup_label": "Delivery / pickup",
        "portfolio_label": "Portfolio",
        "view_menu": "See services",
        "scroll_hint": "Scroll",
        "skip_to_content": "Skip to content",
        "services_eyebrow": "Services",
        "menu_title_html": "Our <em>services</em>",
        "services_fallback": "Services",
        "price_ask": "Ask us",
        "featured_badge": "Featured",
        "visit_eyebrow": "Details",
        "visit_title_html": "Plan your <em>visit</em>",
        "hours_title": "Hours",
        "client_care_title": "How we work",
        "reservations_title": "Reservations",
        "address_title": "Where we are",
        "address_map": "View on Google Maps",
        "location_label": "Location",
        "service_area_title": "Service area",
        "class_schedule_title": "Class schedule",
        "tour_details_title": "About the experience",
        "pet_notes_title": "Before your visit",
        "policies_title": "Policies",
        "links_title": "Links",
        "faq_eyebrow": "FAQ",
        "faq_title_html": "Common <em>questions</em>",
        "share_eyebrow": "Share",
        "share_title_html": "Take us <em>with you</em>",
        "share_lead": "Scan the code or share the direct link.",
        "share_button": "Share link",
        "share_copied": "Link copied",
        "footer_credit": "Made with HMU Link",
        "footer_demo_credit": "Demo made with HMU Link",
        "qr_alt": "QR code for",
        "lang_switch": "Ver esta página en español",
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


def normalize_primary_cta(value):
    """Return a supported preferred CTA kind, if the payload provides one."""
    v = str(value or "").strip().lower()
    if not v:
        return None
    normalized = re.sub(r"[^a-z0-9]+", "_", v).strip("_")
    aliases = {
        "wa": "whatsapp",
        "wpp": "whatsapp",
        "whats": "whatsapp",
        "whatsapp": "whatsapp",
        "telefono": "phone",
        "phone": "phone",
        "phone_call": "phone",
        "call": "phone",
        "llamar": "phone",
        "llamada_telefonica": "phone",
        "booking": "booking",
        "book": "booking",
        "reservation": "booking",
        "reservas": "booking",
        "reservar": "booking",
        "external_booking_link": "booking",
        "enlace_externo_de_reservas": "booking",
        "website": "website",
        "web": "website",
        "sitio_web": "website",
        "site": "website",
        "tiktok": "tiktok",
        "tik_tok": "tiktok",
        "tt": "tiktok",
        "instagram": "instagram",
        "ig": "instagram",
        "insta": "instagram",
        "facebook": "facebook",
        "fb": "facebook",
        "face": "facebook",
        "email": "email",
        "mail": "email",
        "correo": "email",
        "other": "other",
        "otro": "other",
        "other_public_link": "other",
        "otro_enlace_publico": "other",
        "external_link": "other",
        "enlace_externo": "other",
        "maps": "maps",
        "map": "maps",
        "google_maps": "maps",
        "directions": "maps",
        "google_maps_directions": "maps",
        "google_maps_como_llegar": "maps",
        "como_llegar": "maps",
        "mapa": "maps",
    }
    return aliases.get(normalized)


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
_SPANISH_MARKER_WORDS = {
    "artesanias",
    "cancela",
    "cancelaciones",
    "conozcan",
    "creando",
    "cultura",
    "descubre",
    "divierten",
    "economia",
    "experiencia",
    "extranjeros",
    "mientras",
    "muertos",
    "politicas",
    "servicios",
}

_SPANISH_MARKER_PHRASES = (
    " al menos ",
    " antes de tu ",
    " dia de muertos",
    " por persona",
    " para que ",
    " tu experiencia",
)


def _plain_latin(value) -> str:
    """Lowercase text with accents removed for lightweight language checks."""
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower()


def _content_text(block: dict) -> str:
    """Collect visible content fields that should match the block language."""
    parts = [
        block.get("short_description", ""),
        block.get("opening_hours_text", ""),
        block.get("service_area_text", ""),
        block.get("client_care_text", ""),
        block.get("reservations_text", ""),
        block.get("class_schedule_text", ""),
        block.get("tour_details_text", ""),
        block.get("pet_notes_text", ""),
    ]
    parts.extend(block.get("service_categories") or [])
    for svc in block.get("services") or []:
        if isinstance(svc, dict):
            parts.extend(
                [
                    svc.get("category", ""),
                    svc.get("name", ""),
                    svc.get("description", ""),
                ]
            )
    parts.extend(block.get("policies") or [])
    for item in block.get("faq") or []:
        if isinstance(item, dict):
            parts.extend([item.get("question", ""), item.get("answer", "")])
    featured = block.get("featured_package")
    if isinstance(featured, dict):
        parts.extend(
            [
                featured.get("name", ""),
                featured.get("description", ""),
                featured.get("price_label", ""),
            ]
        )
    return " ".join(str(part) for part in parts if part)


def _spanish_signal_score(text: str) -> int:
    plain = f" {_plain_latin(text)} "
    score = sum(2 for phrase in _SPANISH_MARKER_PHRASES if phrase in plain)
    words = set(re.findall(r"[a-z]+", plain))
    score += sum(1 for word in _SPANISH_MARKER_WORDS if word in words)
    return score


def validate_language_quality(payload: dict) -> None:
    """Catch obvious untranslated English blocks before publishing."""
    block = payload.get("content", {}).get("en")
    if not isinstance(block, dict):
        return
    score = _spanish_signal_score(_content_text(block))
    if score >= 5:
        raise ValidationError(
            "Cliente: content.en parece contener texto en espanol. "
            "Traduce descripcion, servicios, horarios, politicas y destacado "
            "antes de publicar."
        )


# Slug shape guard so the rendering stage is self-defending: the output path
# is built from public_slug, so it must never contain path separators, dots, or
# anything outside a safe slug alphabet — even though the intake builder also
# validates it upstream.
CLIENT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")


def validate_client(payload: dict) -> None:
    """Validate a bilingual real-client payload (client_payload_public v1)."""
    slug = str(payload.get("public_slug", "")).strip()
    if not slug:
        raise ValidationError("Cliente: falta public_slug.")
    if not CLIENT_SLUG_RE.match(slug):
        raise ValidationError(f"Cliente: public_slug invalido: {slug!r}.")
    if payload.get("default_language") not in CLIENT_LANGS:
        raise ValidationError("Cliente: default_language debe ser 'es' o 'en'.")
    if payload.get("brand_style") not in BRAND_STYLES:
        raise ValidationError(
            f"Cliente: brand_style invalido: {payload.get('brand_style')!r}."
        )
    if not str(payload.get("business_name", "")).strip():
        raise ValidationError("Cliente: falta business_name.")

    contact_keys = ("whatsapp", "phone", "public_email", "booking_url", "website", "tiktok")
    if not any(str(payload.get(k, "") or "").strip() for k in contact_keys):
        has_public_link = bool(
            payload.get("other_public_link")
            or payload.get("portfolio_link")
            or payload.get("delivery_pickup_links")
        )
        if not has_public_link:
            raise ValidationError(
                "Cliente: se requiere al menos un contacto publico "
                "(whatsapp, phone, public_email, booking_url, website o link publico)."
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
    validate_language_quality(payload)


# --------------------------------------------------------------------------- #
# HTML fragment builders (all dynamic values are escaped here)
# --------------------------------------------------------------------------- #
def _initials(business_name: str) -> str:
    parts = [p for p in re.split(r"\s+", business_name.strip()) if p]
    letters = "".join(p[0] for p in parts[:2])
    return esc(letters.upper() or "?")


def build_logo(payload: dict) -> str:
    """Topbar monogram: round logo image, or initials in a hairline circle."""
    href = safe_href(payload.get("logo_url"))
    alt = esc(payload.get("business_name"))
    if href:
        return f'<img class="monogram" src="{href}" alt="{alt}">'
    return f'<div class="monogram" aria-hidden="true">{_initials(str(payload.get("business_name", "")))}</div>'


def build_intro(payload: dict, s: dict) -> str:
    """Entrance curtain: business name words staggered, then the curtain lifts."""
    words = [w for w in re.split(r"\s+", str(payload.get("business_name", "")).strip()) if w]
    if not words:
        return ""
    spans = "".join(f"<span>{esc(w)}</span>" for w in words)
    return (
        '<div class="intro" id="intro" aria-hidden="true">'
        f'<div class="intro__brand">{spans}</div>'
        f'<div class="intro__sub">{s["title_suffix"]}</div></div>'
    )


def build_hero_title(payload: dict) -> str:
    """Giant serif H1: the business name split over up to 3 animated lines,
    middle line in accent italics (the WOW editorial signature)."""
    words = [w for w in re.split(r"\s+", str(payload.get("business_name", "")).strip()) if w]
    if not words:
        return '<h1 id="ht"></h1>'
    n = len(words)
    if n == 1:
        groups = [words]
    elif n == 2:
        groups = [[words[0]], [words[1]]]
    elif n == 3:
        groups = [[words[0]], [words[1]], [words[2]]]
    else:
        third = (n + 2) // 3
        groups = [words[:third], words[third:2 * third], words[2 * third:]]
        groups = [g for g in groups if g]
    em_index = len(groups) // 2  # middle line (or 2nd of 2) gets the italics
    lines = []
    for i, group in enumerate(groups):
        text = esc(" ".join(group))
        if i == em_index and len(groups) > 1:
            text = f"<em>{text}</em>"
        lines.append(f'<span class="line"><span>{text}</span></span>')
    long_cls = " h1--long" if max(len(w) for w in words) >= 10 else ""
    name = esc(str(payload.get("business_name", "")))
    return f'<h1 id="ht" class="hero__title{long_cls}" aria-label="{name}">{"".join(lines)}</h1>'


def build_hero_kicker(payload: dict) -> str:
    """Letterspaced kicker over the H1: city · neighborhood from the address."""
    addr = str(payload.get("address", "") or "").strip()
    if not addr:
        return ""
    parts = []
    for part in addr.split(","):
        cleaned = re.sub(r"\b(?:c\.?\s*p\.?|cp|zip)\s*[:#-]?\s*", "", part, flags=re.I)
        cleaned = re.sub(r"\b\d{4,6}\b", "", cleaned).strip(" .,-")
        if cleaned:
            parts.append(cleaned)
    if len(parts) >= 2:
        text = f"{parts[-1]} · {parts[-2]}"
    else:
        text = parts[0] if parts else ""
    return f'<p class="hero__kicker" id="hk">{esc(text)}</p>' if text else ""


def _contact_options(payload: dict, s: dict) -> dict:
    """Available public contact links keyed by CTA kind."""
    options = {}
    wa = whatsapp_href(payload.get("whatsapp"))
    if wa:
        options["whatsapp"] = (esc(wa), s["btn_whatsapp"])
    tel = tel_href(payload.get("phone"))
    if tel:
        options["phone"] = (tel, s["btn_phone"])
    booking = safe_href(payload.get("booking_url"))
    if booking:
        options["booking"] = (booking, s["btn_booking"])
    web = safe_href(payload.get("website"))
    if web:
        options["website"] = (web, s["btn_website"])
    tik = safe_href(payload.get("tiktok"))
    if tik:
        options["tiktok"] = (tik, "TikTok")
    ig = safe_href(payload.get("instagram"))
    if ig:
        options["instagram"] = (ig, "Instagram")
    fb = safe_href(payload.get("facebook"))
    if fb:
        options["facebook"] = (fb, "Facebook")
    mail = mailto_href(payload.get("public_email"))
    if mail:
        options["email"] = (mail, s["btn_email"])
    other = payload.get("other_public_link")
    if isinstance(other, dict):
        href = safe_href(other.get("url"))
        label = str(other.get("label", "") or "").strip() or s["btn_other"]
        if href:
            options["other"] = (href, esc(label))
    first_map = _first_location_map_href(payload)
    if first_map:
        options["maps"] = (first_map, s["btn_maps"])
    return options


def _primary_contact(payload: dict, s: dict):
    """Preferred public contact becomes the primary CTA (hero + fixed dock)."""
    options = _contact_options(payload, s)
    preferred = normalize_primary_cta(payload.get("primary_cta"))
    if preferred in options:
        href, label = options[preferred]
        return preferred, href, label
    for kind in PRIMARY_CTA_CHOICES:
        if kind in options:
            href, label = options[kind]
            return kind, href, label
    return None, None, None


def _all_locations(payload: dict) -> list:
    """Return every location-like entry with at least one public detail."""
    raw_locations = payload.get("locations")
    locations = []
    if isinstance(raw_locations, list):
        source = raw_locations
    else:
        source = [
            {
                "name": payload.get("location_name"),
                "address": payload.get("address"),
                "google_maps_url": payload.get("google_maps_url"),
            }
        ]

    for loc in source:
        if not isinstance(loc, dict):
            continue
        item = {
            "name": str(loc.get("name", "") or "").strip(),
            "address": str(loc.get("address", "") or "").strip(),
            "google_maps_url": loc.get("google_maps_url"),
            "notes": str(loc.get("notes", "") or "").strip(),
        }
        if item["name"] or item["address"] or safe_href(item["google_maps_url"]):
            locations.append(item)

    if not locations:
        maps = payload.get("google_maps_url")
        addr = str(payload.get("address", "") or "").strip()
        if addr or safe_href(maps):
            locations.append({"name": "", "address": addr, "google_maps_url": maps, "notes": ""})
    return locations


def _first_location_map_href(payload: dict):
    for loc in _all_locations(payload):
        href = safe_href(loc.get("google_maps_url"))
        if href:
            return href
    return None


def _location_map_links(payload: dict, s: dict) -> list:
    """Google Maps buttons, one per location that has a map URL."""
    candidates = []
    seen = set()
    for i, loc in enumerate(_all_locations(payload), start=1):
        href = safe_href(loc.get("google_maps_url"))
        if not href or href in seen:
            continue
        seen.add(href)
        name = str(loc.get("name", "") or "").strip()
        fallback = f'{s["location_label"]} {i}'
        candidates.append((href, name or fallback))

    if not candidates:
        return []
    if len(candidates) == 1:
        href, _ = candidates[0]
        return [(href, "Google Maps")]
    return [(href, f"Google Maps - {esc(label)}") for href, label in candidates]


def _type_allows(payload: dict, allowed: set[str]) -> bool:
    business_type = str(payload.get("business_type", "") or "").strip().lower()
    if not business_type or business_type == "general":
        return True
    return business_type in allowed


def _special_public_links(payload: dict, s: dict) -> list:
    links = []
    if _type_allows(payload, DELIVERY_PICKUP_TYPES):
        for item in payload.get("delivery_pickup_links") or []:
            if not isinstance(item, dict):
                continue
            href = safe_href(item.get("url"))
            label = str(item.get("label", "") or "").strip() or s["delivery_pickup_label"]
            if href:
                links.append((href, esc(label)))

    portfolio = payload.get("portfolio_link")
    if isinstance(portfolio, dict) and _type_allows(payload, PORTFOLIO_TYPES):
        href = safe_href(portfolio.get("url"))
        label = str(portfolio.get("label", "") or "").strip() or s["portfolio_label"]
        if href:
            links.append((href, esc(label)))
    return links


def _secondary_links(payload: dict, s: dict, primary_kind) -> list:
    """(href, label) for every public link that is not the primary CTA."""
    links = []
    contact_options = _contact_options(payload, s)
    for kind in PRIMARY_CTA_CHOICES:
        if kind == primary_kind or kind == "maps":
            continue
        option = contact_options.get(kind)
        if option:
            links.append(option)
    for key, label in (
        ("instagram", "Instagram"),
        ("facebook", "Facebook"),
        ("tiktok", "TikTok"),
    ):
        if key == primary_kind:
            continue
        href = safe_href(payload.get(key))
        if href:
            links.append((href, label))
    links.extend(_location_map_links(payload, s))
    reviews = safe_href(payload.get("google_reviews_url"))
    if reviews:
        links.append((reviews, "Google Reviews"))
    links.extend(_special_public_links(payload, s))

    deduped = []
    seen = set()
    for href, label in links:
        key = str(href).lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append((href, label))
    return deduped


def build_cta_row(payload: dict, s: dict) -> str:
    """Hero CTA row: solid primary contact + ghost link to the menu."""
    _, href, label = _primary_contact(payload, s)
    buttons = []
    if href:
        buttons.append(
            f'<a class="btn btn--solid" href="{href}" target="_blank" '
            f'rel="noopener noreferrer">{label}</a>'
        )
    buttons.append(f'<a class="btn btn--ghost" href="#menu">{s["view_menu"]}</a>')
    return f'<div class="cta-row" id="hc">{"".join(buttons)}</div>'


def build_dock(payload: dict, s: dict) -> str:
    """Fixed bottom booking pill; appears once the visitor scrolls past the hero."""
    _, href, label = _primary_contact(payload, s)
    if not href:
        return ""
    return (
        f'<div class="dock" id="dock"><a href="{href}" target="_blank" '
        f'rel="noopener noreferrer">{label}</a></div>'
    )


def _gallery_images(payload: dict) -> list[str]:
    images = []
    raw = payload.get("gallery_images")
    if isinstance(raw, list):
        for item in raw:
            url = item.get("url") if isinstance(item, dict) else item
            href = safe_href(url)
            if href and href not in images:
                images.append(href)
            if len(images) >= 6:
                break
    primary = safe_href(payload.get("primary_image_url"))
    if primary and primary not in images:
        images.insert(0, primary)
    return images[:6]


def build_hero_image(payload: dict, s: dict) -> str:
    """Optional full-width photo band under the hero; becomes a carousel at 2+ photos."""
    images = _gallery_images(payload)
    if not images:
        return ""
    alt = esc(payload.get("business_name"))
    if len(images) == 1:
        return (
            '<div class="shell figure" data-reveal>'
            '<div class="figure__viewport">'
            f'<img class="figure__media" src="{images[0]}" alt="{alt}" loading="lazy">'
            '</div></div>'
        )

    slides = []
    dots = []
    for i, href in enumerate(images):
        load = "eager" if i == 0 else "lazy"
        slides.append(
            '<div class="figure__slide">'
            f'<img class="figure__media" src="{href}" alt="{alt}" loading="{load}">'
            '</div>'
        )
        active = " is-active" if i == 0 else ""
        dots.append(
            f'<button class="gallery-dot{active}" type="button" '
            f'aria-label="{esc(s["gallery_photo"])} {i + 1}"></button>'
        )
    return (
        '<div class="shell figure figure--carousel" data-reveal data-gallery>'
        '<div class="figure__viewport">'
        '<div class="figure__track">'
        f'{"".join(slides)}'
        '</div>'
        f'<button class="gallery-btn gallery-btn--prev" type="button" aria-label="{esc(s["gallery_prev"])}">‹</button>'
        f'<button class="gallery-btn gallery-btn--next" type="button" aria-label="{esc(s["gallery_next"])}">›</button>'
        '</div>'
        f'<div class="gallery-dots">{"".join(dots)}</div>'
        '</div>'
    )


def build_marquee(payload: dict) -> str:
    """Infinite marquee strip built from service categories (or service names)."""
    items = [str(c).strip() for c in (payload.get("service_categories") or []) if str(c).strip()]
    if not items:
        items = [
            str(svc.get("name", "")).strip()
            for svc in (payload.get("services") or [])
            if str(svc.get("name", "")).strip()
        ][:6]
    if not items:
        return ""
    parts = []
    for i, item in enumerate(items):
        text = esc(item)
        if i % 2 == 1:
            text = f"<em>{text}</em>"
        parts.append(f'<span>{text} <span class="dot">✦</span></span>')
    base_repeat = max(4, 12 // len(parts))
    track = "".join(parts * base_repeat) * 2  # duplicated for the seamless CSS loop
    return (
        '<div class="marquee" aria-hidden="true">'
        f'<div class="marquee__track">{track}</div></div>'
    )


def build_services(payload: dict, s: dict) -> str:
    """Editorial price list: italic serif category titles + dotted-leader rows."""
    services = payload.get("services") or []
    declared = payload.get("service_categories") or []
    hide_prices = payload.get("price_display") == "hide"

    # Preserve declared category order, then append any leftover categories.
    order = list(declared)
    for svc in services:
        cat = svc.get("category")
        if cat and cat not in order:
            order.append(cat)

    def render_service(svc: dict) -> str:
        name = esc(svc.get("name"))
        desc = svc.get("description")
        price = None if hide_prices else svc.get("price_label")
        left = f'<span class="mrow__name">{name}</span>'
        if desc:
            left += f'<span class="mrow__desc">{esc(desc)}</span>'
        # Con precio → se muestra. Sin precio y política "mostrar" → leyenda
        # "Consultar"/"Ask us" (se ve intencional). Política "ocultar" → nada.
        if price:
            price_text = esc(price)
        elif not hide_prices:
            price_text = esc(s["price_ask"])
        else:
            price_text = ""
        price_html = (
            f'<span class="mrow__dots"></span><span class="mrow__price">{price_text}</span>'
            if price_text
            else ""
        )
        return f'<div class="mrow"><div>{left}</div>{price_html}</div>'

    def render_category(title: str, items: list) -> str:
        rows = "".join(render_service(item) for item in items)
        return (
            '<div class="menu-cat" data-reveal>'
            f'<div class="menu-cat__head"><h3 class="menu-cat__title">{title}</h3>'
            '<span class="menu-cat__rule"></span></div>'
            f'{rows}</div>'
        )

    blocks = []
    used = set()
    for cat in order:
        items = [svc for svc in services if svc.get("category") == cat]
        if not items:
            continue
        for item in items:
            used.add(id(item))
        blocks.append(render_category(esc(cat), items))

    # Services without a (matching) category go under a generic group.
    leftovers = [svc for svc in services if id(svc) not in used]
    if leftovers:
        blocks.append(render_category(s["services_fallback"], leftovers))

    return (
        '<section class="section" id="menu" data-theme="base"><div class="shell">'
        f'<p class="eyebrow" data-reveal>{s["services_eyebrow"]}</p>'
        f'<h2 data-reveal>{s["menu_title_html"]}</h2>'
        + "".join(blocks)
        + "</div></section>"
    )


def build_featured(payload: dict, s: dict) -> str:
    """Featured package as the glowing "signature" card (spinning accent border)."""
    pkg = payload.get("featured_package")
    if not isinstance(pkg, dict) or not str(pkg.get("name", "")).strip():
        return ""
    name = esc(pkg.get("name"))
    desc = esc(pkg.get("description"))
    price = None if payload.get("price_display") == "hide" else pkg.get("price_label")
    price_html = f'<div class="ritual__price">{esc(price)}</div>' if price else ""
    # Sin descripción (o igual al nombre) no se repite el texto.
    desc_html = f'<p class="ritual__desc">{desc}</p>' if desc and desc != name else ""
    return (
        '<section class="section section--featured" data-theme="alt"><div class="shell">'
        '<div class="ritual" data-reveal><div class="ritual__in">'
        f'<span class="ritual__badge">{s["featured_badge"]}</span>'
        f'<h3 class="ritual__name serif">{name}</h3>'
        f'{desc_html}{price_html}'
        "</div></div></div></section>"
    )


def _address_map_link(maps_url, s: dict) -> str:
    maps = safe_href(maps_url)
    if not maps:
        return ""
    return (
        f'<a class="mapl" href="{maps}" target="_blank" '
        f'rel="noopener noreferrer">{s["address_map"]}</a>'
    )


def _address_row_body(payload: dict, s: dict) -> str:
    """Inner HTML for the address info-row ('' if the payload has no address)."""
    locations = _all_locations(payload)
    if len(locations) > 1:
        items = []
        for loc in locations:
            addr = str(loc.get("address", "") or "").strip()
            link = _address_map_link(loc.get("google_maps_url"), s)
            if not (addr or link):
                continue
            name = str(loc.get("name", "") or "").strip()
            name_html = f'<h4 class="address__name">{esc(name)}</h4>' if name else ""
            notes = str(loc.get("notes", "") or "").strip()
            notes_html = f'<p class="address__notes">{esc(notes)}</p>' if notes else ""
            main = esc(addr) if addr else link
            items.append(
                f'<div class="address__item">{name_html}'
                f'<p>{main}{"<br>" + link if addr and link else ""}</p>{notes_html}</div>'
            )
        return "".join(items)

    loc = locations[0] if locations else {}
    addr = str(loc.get("address", "") or "").strip()
    link = _address_map_link(loc.get("google_maps_url"), s)
    if not (addr or link):
        return ""
    if addr:
        return f'<p>{esc(addr)}{"<br>" + link if link else ""}</p>'
    return f"<p>{link}</p>"


def build_info(payload: dict, s: dict) -> str:
    """"Find us" section (alt theme): hours, address, policies and extra links
    as hairline info rows — this is where the background fusion happens."""
    rows = []

    hours = str(payload.get("opening_hours_text", "") or "").strip()
    if hours:
        # Un renglon por linea del payload (p. ej. un dia por renglon).
        hours_html = "<br>".join(
            esc(line.strip()) for line in hours.splitlines() if line.strip()
        )
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["hours_title"]}</h3>'
            f'<p>{hours_html}</p></div>'
        )

    service_area = str(payload.get("service_area_text", "") or "").strip()
    if service_area:
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["service_area_title"]}</h3>'
            f'<p>{esc(service_area)}</p></div>'
        )

    client_care = str(payload.get("client_care_text", "") or "").strip()
    if client_care:
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["client_care_title"]}</h3>'
            f'<p>{esc(client_care)}</p></div>'
        )

    reservations = str(payload.get("reservations_text", "") or "").strip()
    if reservations:
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["reservations_title"]}</h3>'
            f'<p>{esc(reservations)}</p></div>'
        )

    class_schedule = str(payload.get("class_schedule_text", "") or "").strip()
    if class_schedule:
        sched_html = "<br>".join(esc(l.strip()) for l in class_schedule.splitlines() if l.strip())
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["class_schedule_title"]}</h3>'
            f'<p>{sched_html}</p></div>'
        )

    tour_details = str(payload.get("tour_details_text", "") or "").strip()
    if tour_details:
        tour_html = "<br>".join(esc(l.strip()) for l in tour_details.splitlines() if l.strip())
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["tour_details_title"]}</h3>'
            f'<p>{tour_html}</p></div>'
        )

    pet_notes = str(payload.get("pet_notes_text", "") or "").strip()
    if pet_notes:
        pet_html = "<br>".join(esc(l.strip()) for l in pet_notes.splitlines() if l.strip())
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["pet_notes_title"]}</h3>'
            f'<p>{pet_html}</p></div>'
        )

    address_body = _address_row_body(payload, s)
    if address_body:
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["address_title"]}</h3>'
            f'{address_body}</div>'
        )

    policies = payload.get("policies") or []
    items = [f"<li>{esc(p)}</li>" for p in policies if str(p).strip()]
    if items:
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["policies_title"]}</h3>'
            f'<ul>{"".join(items)}</ul></div>'
        )

    primary_kind, _, _ = _primary_contact(payload, s)
    links = _secondary_links(payload, s, primary_kind)
    if links:
        pills = "".join(
            f'<a class="btn btn--ghost btn--sm" href="{href}" target="_blank" '
            f'rel="noopener noreferrer">{label}</a>'
            for href, label in links
        )
        rows.append(
            f'<div class="info-row" data-reveal><h3>{s["links_title"]}</h3>'
            f'<div class="cta-row">{pills}</div></div>'
        )

    if not rows:
        return ""
    return (
        '<section class="section" data-theme="alt"><div class="shell">'
        f'<p class="eyebrow" data-reveal>{s["visit_eyebrow"]}</p>'
        f'<h2 data-reveal>{s["visit_title_html"]}</h2>'
        f'<div class="info-grid">{"".join(rows)}</div>'
        "</div></section>"
    )


def build_faq(payload: dict, s: dict) -> str:
    """Simple FAQ section for conversion-critical practical questions."""
    faq = payload.get("faq") or []
    items = []
    for item in faq:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "") or "").strip()
        answer = str(item.get("answer", "") or "").strip()
        if not question or not answer:
            continue
        items.append(
            '<div class="faq-item" data-reveal>'
            f'<h3>{esc(question)}</h3><p>{esc(answer)}</p></div>'
        )
    if not items:
        return ""
    return (
        '<section class="section" data-theme="base"><div class="shell">'
        f'<p class="eyebrow" data-reveal>{s["faq_eyebrow"]}</p>'
        f'<h2 data-reveal>{s["faq_title_html"]}</h2>'
        f'<div class="faq-list">{"".join(items)}</div>'
        "</div></section>"
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
    """"Share" section: QR image + visible link, centered, base theme.

    The QR references the static asset written next to the page (qr.svg) or at
    the client root (../qr.svg for alternate-language pages). No JavaScript,
    no external scripts, no tracking.
    """
    href = safe_href(public_url)
    shown = esc(re.sub(r"^https?://(www\.)?", "", str(public_url)).rstrip("/"))
    alt = esc(f"{s['qr_alt']} {public_url}")

    link_line = (
        f'<a class="share__url" href="{href}" target="_blank" rel="noopener noreferrer">{shown}</a>'
        if href
        else f'<span class="share__url">{shown}</span>'
    )
    share_button = (
        f'<div class="share__actions"><button class="btn btn--solid btn--sm share-btn" '
        f'type="button" data-share-url="{href}" data-share-title="{esc(public_url)}" '
        f'data-copied="{esc(s["share_copied"])}">{s["share_button"]}</button></div>'
        if href
        else ""
    )
    return (
        '<section class="section share" id="compartir" data-theme="base"><div class="shell">'
        f'<p class="eyebrow" data-reveal>{s["share_eyebrow"]}</p>'
        f'<h2 data-reveal>{s["share_title_html"]}</h2>'
        f'<p class="lead" data-reveal>{s["share_lead"]}</p>'
        f'<div class="qrbox" data-reveal><img src="{esc(qr_src)}" '
        f'alt="{alt}" width="180" height="180"></div>'
        f'{link_line}{share_button}'
        "</div></section>"
    )


def build_footer(payload: dict, text: str = "HMU Link - Demo") -> str:
    name = esc(payload.get("business_name"))
    return (
        '<footer class="footer">'
        f'<span class="serif">{name}</span>'
        f'{esc(text)}'
        "</footer>"
    )


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
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
        "{{SHORT_DESCRIPTION}}": esc(view.get("short_description")),
        "{{LANG_SWITCH_BLOCK}}": lang_switch_html,
        "{{LOGO_BLOCK}}": build_logo(view),
        "{{INTRO_BLOCK}}": build_intro(view, s),
        "{{HERO_KICKER_BLOCK}}": build_hero_kicker(view),
        "{{HERO_TITLE_BLOCK}}": build_hero_title(view),
        "{{CTA_ROW_BLOCK}}": build_cta_row(view, s),
        "{{HERO_IMAGE_BLOCK}}": build_hero_image(view, s),
        "{{MARQUEE_BLOCK}}": build_marquee(view),
        "{{SERVICES_BLOCK}}": build_services(view, s),
        "{{FEATURED_BLOCK}}": build_featured(view, s),
        "{{INFO_BLOCK}}": build_info(view, s),
        "{{FAQ_BLOCK}}": build_faq(view, s),
        "{{SHARE_BLOCK}}": build_share(share_url, s, qr_src),
        "{{FOOTER_BLOCK}}": build_footer(view, footer_text),
        "{{DOCK_BLOCK}}": build_dock(view, s),
        "{{SCROLL_HINT}}": s["scroll_hint"],
        "{{SKIP_LINK_BLOCK}}": f'<a class="skip" href="#content">{esc(s["skip_to_content"])}</a>',
    }

    out = template
    for token, value in tokens.items():
        out = out.replace(token, value)
    return out


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
            "business_type",
            "logo_url",
            "primary_image_url",
            "gallery_images",
            "whatsapp",
            "phone",
            "public_email",
            "instagram",
            "facebook",
            "tiktok",
            "website",
            "booking_url",
            "primary_cta",
            "google_maps_url",
            "google_reviews_url",
            "other_public_link",
            "delivery_pickup_links",
            "portfolio_link",
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
        footer_text=STRINGS[default_lang]["footer_credit"],
        share_url=root_url,
        qr_src=QR_ASSET_NAME,
    )
    alt_html = render_view(
        client_lang_view(payload, alt_lang),
        alt_lang,
        head_meta=head[alt_lang],
        lang_switch_html=switch[alt_lang],
        footer_text=STRINGS[alt_lang]["footer_credit"],
        share_url=root_url,
        qr_src=f"../{QR_ASSET_NAME}",
    )

    (root_dir / "index.html").write_text(default_html, encoding="utf-8")
    (alt_dir / "index.html").write_text(alt_html, encoding="utf-8")
    # One QR per client, encoding the default-language URL.
    (root_dir / QR_ASSET_NAME).write_text(make_qr_svg(root_url), encoding="utf-8")
    return root_dir / "index.html"


# --------------------------------------------------------------------------- #
# Demo rendering (bilingual)
# --------------------------------------------------------------------------- #
def build_demo(json_path: Path) -> Path:
    """Generate both language pages + one QR for a bilingual demo payload.

    Spanish is the default at the slug root (`demos/<slug>/`); English lives in
    `demos/<slug>/en/`. Every page carries a language switch and is `noindex`
    (demos are not meant to rank), so — unlike real clients — they get no
    canonical/hreflang. The footer reads "HMU Link - Demo".
    """
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    validate_client(payload)

    slug = str(payload["public_slug"]).strip()
    default_lang = payload.get("default_language", "es")
    alt_lang = "en" if default_lang == "es" else "es"

    root_url = f"{DEMO_BASE_URL}/{slug}/"

    root_dir = OUTPUT_DIR / slug
    root_dir.mkdir(parents=True, exist_ok=True)
    alt_dir = root_dir / alt_lang
    alt_dir.mkdir(parents=True, exist_ok=True)

    # Language switch: the default page links into the subfolder; the alternate
    # page links back to the root. Labels are in the *target* language.
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
        head_meta=DEMO_HEAD_META,
        lang_switch_html=switch[default_lang],
        footer_text=STRINGS[default_lang]["footer_demo_credit"],
        share_url=root_url,
        qr_src=QR_ASSET_NAME,
    )
    alt_html = render_view(
        client_lang_view(payload, alt_lang),
        alt_lang,
        head_meta=DEMO_HEAD_META,
        lang_switch_html=switch[alt_lang],
        footer_text=STRINGS[alt_lang]["footer_demo_credit"],
        share_url=root_url,
        qr_src=f"../{QR_ASSET_NAME}",
    )

    (root_dir / "index.html").write_text(default_html, encoding="utf-8")
    (alt_dir / "index.html").write_text(alt_html, encoding="utf-8")
    # One QR per demo, encoding the default-language (root) URL.
    (root_dir / QR_ASSET_NAME).write_text(make_qr_svg(root_url), encoding="utf-8")
    return root_dir / "index.html"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


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
            out_file = build_demo(path)
            rel = out_file.relative_to(REPO_ROOT)
            print(f"[ok]   {path.name} -> {rel} (+ alterno bilingue)")
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
