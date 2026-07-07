#!/usr/bin/env python3
"""Build a real-client page from an automated intake dispatch (Phase 6).

Runs inside GitHub Actions when the service-menu-worker dispatches a
`new-hmu-service-menu` repository_dispatch event. The full sanitized public
payload travels in the event's client_payload (proven upstream pattern), so this
script never talks to KV or Stripe. It does fetch the logo/photo files
directly from their Tally-hosted URLs (no Tally API calls, just the public
upload links already present in the payload).

Input:  env INTAKE_PAYLOAD — JSON string:
        { order_id, submission_id, slug, public_payload: {...} }
Output: data/clients/<slug>.client.json  (client_payload_public v1)
        public/links/<slug>/             (via generate_service_menu.py)
        public/links/<slug>/assets/      (downloaded logo/hero image, if any)
        GITHUB_OUTPUT slug=<slug>        (for later workflow steps)

Security notes:
- The payload contains ONLY approved public fields (the Worker filters).
- This script never prints the payload to stdout (public repo logs).
- After generation it scans the HTML output for the order_id as a guard.
- Downloaded images are only kept if content-type is jpeg/png/webp and size
  is under MAX_IMAGE_BYTES; anything else is skipped (page falls back to the
  placeholder), it never blocks generation.

Translation: the intake is authored in one language (default_language). When
OPENAI_API_KEY is configured, the other language's short_description, service
names, policies and featured_package are translated via the OpenAI API
(gpt-4o-mini). If the key is missing or the call fails, both languages just
publish the same source-language text (original v1 behavior) — translation
never blocks page generation.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CLIENTS_DIR = REPO_ROOT / "data" / "clients"
LINKS_DIR = REPO_ROOT / "public" / "links"
CLIENT_BASE_URL = "https://www.hmulink.com/links"

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")
BULLET_RE = re.compile(r"^[\s\-\*•·–—>]+")
TRAIL_SEP_RE = re.compile(r"[\s\-–—·:|,]+$")

IMAGE_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB
# Defensa en profundidad: solo se descargan imágenes hospedadas por Tally
# (los FILE_UPLOAD del intake viven ahí). Cualquier otro host se ignora.
ALLOWED_IMAGE_HOSTS_SUFFIX = (".tally.so",)


def _allowed_image_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return host == "tally.so" or host.endswith(ALLOWED_IMAGE_HOSTS_SUFFIX)


def download_image(url: str, dest_dir: Path, basename: str) -> str | None:
    """Download a Tally-hosted image and publish it under dest_dir.

    Returns the published filename, or None if the URL is empty, the host
    isn't Tally's storage, the content-type isn't an allowed image format,
    or the download fails. Never raises: an image problem should not block
    page generation.
    """
    url = (url or "").strip()
    if not url:
        return None
    if not _allowed_image_url(url):
        print(f"WARN: image skipped, host not allowed: {url}", file=sys.stderr)
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hmulink-generator/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            content_type = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
            ext = IMAGE_EXT_BY_CONTENT_TYPE.get(content_type)
            if not ext:
                print(f"WARN: image skipped, unsupported content-type {content_type!r}: {url}", file=sys.stderr)
                return None
            data = resp.read(MAX_IMAGE_BYTES + 1)
            if len(data) > MAX_IMAGE_BYTES:
                print(f"WARN: image skipped, exceeds {MAX_IMAGE_BYTES} bytes: {url}", file=sys.stderr)
                return None
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"WARN: image download failed ({e}): {url}", file=sys.stderr)
        return None

    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{basename}{ext}"
    (dest_dir / filename).write_bytes(data)
    return filename


def build_locations(payload: dict) -> list[dict]:
    """Assemble the full locations list (1-3) from intake fields.

    Only returned as a distinct client field when there's more than one
    location; a single location keeps using the legacy top-level
    address/google_maps_url fields (unchanged rendering).
    """
    locations = [{
        "name": str(payload.get("location_1_name", "") or "").strip(),
        "address": str(payload.get("address", "") or "").strip(),
        "google_maps_url": url_or_none(payload.get("google_maps_url", "")),
    }]
    for i in (2, 3):
        name = str(payload.get(f"location_{i}_name", "") or "").strip()
        address = str(payload.get(f"location_{i}_address", "") or "").strip()
        if not (name or address):
            continue
        loc = {"name": name, "address": address}
        maps = url_or_none(payload.get(f"location_{i}_maps_url", ""))
        if maps:
            loc["google_maps_url"] = maps
        notes = str(payload.get(f"location_{i}_notes", "") or "").strip()
        if notes:
            loc["notes"] = notes
        locations.append(loc)
    return locations


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def clean_line(line: str) -> str:
    return TRAIL_SEP_RE.sub("", BULLET_RE.sub("", line.strip())).strip()


def parse_services(services_text: str, category: str) -> list[dict]:
    """Each non-empty line is one service; text after the last '$' is the price."""
    services = []
    for raw in (services_text or "").splitlines():
        line = clean_line(raw)
        if not line:
            continue
        name, price_label = line, None
        idx = line.rfind("$")
        if idx > 0:
            candidate_name = TRAIL_SEP_RE.sub("", line[:idx]).strip()
            candidate_price = line[idx:].strip()
            if candidate_name and len(candidate_price) <= 40:
                name, price_label = candidate_name, candidate_price
        svc = {"category": category, "name": name[:120]}
        if price_label:
            svc["price_label"] = price_label
        services.append(svc)
    return services


def parse_policies(policies_text: str) -> list[str]:
    out = []
    for raw in (policies_text or "").splitlines():
        line = clean_line(raw)
        if line:
            out.append(line[:200])
    return out


def parse_featured(featured_text: str) -> dict | None:
    lines = [clean_line(l) for l in (featured_text or "").splitlines()]
    lines = [l for l in lines if l]
    if not lines:
        return None
    first = lines[0]
    name, price_label = first, None
    idx = first.rfind("$")
    if idx > 0:
        candidate = TRAIL_SEP_RE.sub("", first[:idx]).strip()
        if candidate:
            name, price_label = candidate, first[idx:].strip()
    featured = {"name": name[:120], "description": " ".join(lines[1:])[:300]}
    if price_label:
        featured["price_label"] = price_label
    return featured


def url_or_none(value: str) -> str | None:
    v = (value or "").strip()
    if not v:
        return None
    if not v.lower().startswith(("http://", "https://")):
        v = "https://" + v
    return v


def social_url(value: str, base: str, handle_prefix: str = "") -> str | None:
    """Accepts a full URL, a domain path (instagram.com/x) or a bare handle
    (@unveilmexico / unveilmexico) and returns a valid profile URL."""
    v = (value or "").strip()
    if not v:
        return None
    if v.lower().startswith(("http://", "https://")):
        return v
    if "." in v.split("/")[0]:  # looks like a domain: instagram.com/x, www...
        return "https://" + v
    handle = v.lstrip("@").strip("/").split("/")[0]
    if not handle:
        return None
    return f"https://{base}/{handle_prefix}{handle}"


LANG_NAMES = {"es": "Spanish", "en": "English"}

SPANISH_MARKER_WORDS = {
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

SPANISH_MARKER_PHRASES = (
    " al menos ",
    " antes de tu ",
    " dia de muertos",
    " por persona",
    " para que ",
    " tu experiencia",
)


def plain_latin(value) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower()


def spanish_signal_score(text: str) -> int:
    plain = f" {plain_latin(text)} "
    score = sum(2 for phrase in SPANISH_MARKER_PHRASES if phrase in plain)
    words = set(re.findall(r"[a-z]+", plain))
    score += sum(1 for word in SPANISH_MARKER_WORDS if word in words)
    return score


def content_text(block: dict) -> str:
    parts = [
        block.get("short_description", ""),
        block.get("opening_hours_text", ""),
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


def translate_block(source_lang: str, target_lang: str, fields: dict) -> dict | None:
    """Translate short_description/services/policies/featured via OpenAI.

    `fields` is a flat dict of translatable strings/lists (see call site).
    Returns a dict with the same keys translated, or None if OPENAI_API_KEY
    is missing or the call/response is unusable. Never raises: a translation
    problem must fall back to publishing the source-language text, not block
    page generation.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    prompt = (
        f"Translate the following small-business page content from "
        f"{LANG_NAMES[source_lang]} to {LANG_NAMES[target_lang]}. Keep prices, "
        f"numbers, phone numbers and proper nouns (business names, brand names) "
        f"unchanged. Return ONLY a JSON object with exactly the same keys and "
        f"structure as the input, with translated string values.\n\n"
        f"{json.dumps(fields, ensure_ascii=False)}"
    )
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        translated = json.loads(content)
        return translated if isinstance(translated, dict) else None
    except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
        print(f"WARN: translation failed ({e}); publishing source-language text for {target_lang}", file=sys.stderr)
        return None


def apply_translation(content: dict, source_lang: str, target_lang: str) -> None:
    """Translate content[target_lang] in place from content[source_lang].

    Every translated field is validated (type + shape) before being applied;
    anything missing or malformed just keeps the original source-language
    fallback text already in content[target_lang].
    """
    src = content[source_lang]
    fields = {
        "short_description": src["short_description"],
        "opening_hours_text": src["opening_hours_text"],
        "service_names": [s["name"] for s in src["services"]],
        "policies": src["policies"],
    }
    if "featured_package" in src:
        fields["featured_name"] = src["featured_package"]["name"]
        fields["featured_description"] = src["featured_package"].get("description", "")

    translated = translate_block(source_lang, target_lang, fields)
    if not translated:
        return

    tgt = content[target_lang]
    if isinstance(translated.get("short_description"), str) and translated["short_description"].strip():
        tgt["short_description"] = translated["short_description"][:300]
    if isinstance(translated.get("opening_hours_text"), str) and translated["opening_hours_text"].strip():
        tgt["opening_hours_text"] = translated["opening_hours_text"][:200]

    names = translated.get("service_names")
    if isinstance(names, list) and len(names) == len(tgt["services"]):
        for svc, name in zip(tgt["services"], names):
            if isinstance(name, str) and name.strip():
                svc["name"] = name[:120]

    pols = translated.get("policies")
    if isinstance(pols, list) and len(pols) == len(tgt["policies"]):
        if all(isinstance(p, str) for p in pols):
            tgt["policies"] = [p[:200] for p in pols]

    if "featured_package" in tgt:
        if isinstance(translated.get("featured_name"), str) and translated["featured_name"].strip():
            tgt["featured_package"]["name"] = translated["featured_name"][:120]
        if isinstance(translated.get("featured_description"), str):
            tgt["featured_package"]["description"] = translated["featured_description"][:300]


def main() -> int:
    raw = os.environ.get("INTAKE_PAYLOAD", "")
    if not raw:
        fail("INTAKE_PAYLOAD env var is empty")
    try:
        event = json.loads(raw)
    except json.JSONDecodeError as e:
        fail(f"INTAKE_PAYLOAD is not valid JSON: {e}")

    order_id = str(event.get("order_id", "")).strip()
    slug = str(event.get("slug", "")).strip()
    payload = event.get("public_payload") or {}

    if not slug or not SLUG_RE.match(slug):
        fail(f"invalid or missing slug")
    if not isinstance(payload, dict) or not payload.get("business_name"):
        fail("public_payload missing business_name")

    default_language = payload.get("default_language")
    if default_language not in ("es", "en"):
        default_language = "es"

    services_es = parse_services(payload.get("services_text", ""), "Servicios")
    services_en = parse_services(payload.get("services_text", ""), "Services")
    if not services_es:
        fail("intake has no parseable services — manual review required")

    policies = parse_policies(payload.get("policies_text", ""))
    featured = parse_featured(payload.get("featured_text", ""))

    short_description = str(payload.get("short_description", "")).strip() or str(payload.get("business_name", "")).strip()
    hours = str(payload.get("opening_hours_text", "")).strip() or "Consultar horarios / Ask us for hours"
    address = str(payload.get("address", "")).strip()

    def content_block(lang: str) -> dict:
        # Each language gets its own copies of the mutable structures: later,
        # apply_translation() overwrites content[target_lang] in place and
        # must never affect content[source_lang]'s original text.
        block = {
            "short_description": short_description[:300],
            "address": address[:200],
            "opening_hours_text": hours[:200],
            "service_categories": ["Servicios" if lang == "es" else "Services"],
            "services": [dict(s) for s in (services_es if lang == "es" else services_en)],
            "policies": list(policies),
        }
        if featured:
            block["featured_package"] = dict(featured)
        return block

    assets_dir = LINKS_DIR / slug / "assets"
    logo_file = download_image(payload.get("logo_url", ""), assets_dir, "logo")
    hero_file = download_image(payload.get("image_url", ""), assets_dir, "hero")

    locations = build_locations(payload)

    client = {
        "public_slug": slug,
        "default_language": default_language,
        "brand_style": payload.get("brand_style", "warm-sand"),
        "business_name": str(payload.get("business_name", "")).strip()[:120],
        "logo_url": f"{CLIENT_BASE_URL}/{slug}/assets/{logo_file}" if logo_file else None,
        "primary_image_url": f"{CLIENT_BASE_URL}/{slug}/assets/{hero_file}" if hero_file else None,
        "whatsapp": str(payload.get("whatsapp", "")).strip() or None,
        "phone": str(payload.get("phone", "")).strip() or None,
        "public_email": str(payload.get("public_email", "")).strip() or None,
        "instagram": social_url(payload.get("instagram", ""), "instagram.com"),
        "facebook": social_url(payload.get("facebook", ""), "facebook.com"),
        "tiktok": social_url(payload.get("tiktok", ""), "www.tiktok.com", handle_prefix="@"),
        "website": url_or_none(payload.get("website", "")),
        "booking_url": url_or_none(payload.get("booking_url", "")),
        "google_maps_url": url_or_none(payload.get("google_maps_url", "")),
        "google_reviews_url": url_or_none(payload.get("google_reviews_url", "")),
        "content": {"es": content_block("es"), "en": content_block("en")},
    }
    if len(locations) > 1:
        client["locations"] = locations

    # The intake is usually authored in default_language. If the customer asks
    # for English first but wrote the intake in Spanish, treat Spanish as the
    # source so the default English page is actually translated before publish.
    source_lang = default_language
    if default_language == "en" and spanish_signal_score(content_text(client["content"]["en"])) >= 5:
        source_lang = "es"

    other_lang = "en" if source_lang == "es" else "es"
    apply_translation(client["content"], source_lang, other_lang)

    if default_language == "en" and spanish_signal_score(content_text(client["content"]["en"])) >= 5:
        fail(
            "default_language is 'en' but the English page still looks Spanish; "
            "set OPENAI_API_KEY or translate the intake manually before publishing"
        )

    if not (client["whatsapp"] or client["phone"] or client["public_email"] or client["booking_url"]):
        fail("no public contact (whatsapp/phone/email/booking) — manual review required")

    CLIENTS_DIR.mkdir(parents=True, exist_ok=True)
    client_path = CLIENTS_DIR / f"{slug}.client.json"
    client_path.write_text(json.dumps(client, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"client JSON written: {client_path.relative_to(REPO_ROOT)}")

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "generator" / "generate_service_menu.py"), "--client", str(client_path)],
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        fail(f"generator failed with exit code {result.returncode}")

    out_dir = LINKS_DIR / slug
    index_html = out_dir / "index.html"
    if not index_html.exists():
        fail(f"expected output missing: {index_html}")

    # QA guard: the order_id must never appear in published HTML.
    if order_id:
        for html_file in out_dir.rglob("*.html"):
            if order_id in html_file.read_text(encoding="utf-8"):
                html_file.unlink()
                fail(f"order_id leaked into {html_file.name} — build blocked")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"slug={slug}\n")

    print(f"page generated: public/links/{slug}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
