#!/usr/bin/env python3
"""Build a real-client page from an automated intake dispatch (Phase 6).

Runs inside GitHub Actions when the service-menu-worker dispatches a
`new-hmu-service-menu` repository_dispatch event. The full sanitized public
payload travels in the event's client_payload (proven upstream pattern), so this
script never talks to KV, Tally or Stripe.

Input:  env INTAKE_PAYLOAD — JSON string:
        { order_id, submission_id, slug, public_payload: {...} }
Output: data/clients/<slug>.client.json  (client_payload_public v1)
        public/links/<slug>/             (via generate_service_menu.py)
        GITHUB_OUTPUT slug=<slug>        (for later workflow steps)

Security notes:
- The payload contains ONLY approved public fields (the Worker filters).
- This script never prints the payload to stdout (public repo logs).
- After generation it scans the HTML output for the order_id as a guard.

Translation note (v1): the intake arrives in one language; content.es and
content.en are published with the same text. Light manual translation can be
applied later via the correction flow or a follow-up commit.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CLIENTS_DIR = REPO_ROOT / "data" / "clients"
LINKS_DIR = REPO_ROOT / "public" / "links"

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")
BULLET_RE = re.compile(r"^[\s\-\*•·–—>]+")
TRAIL_SEP_RE = re.compile(r"[\s\-–—·:|,]+$")


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
        block = {
            "short_description": short_description[:300],
            "address": address[:200],
            "opening_hours_text": hours[:200],
            "service_categories": ["Servicios" if lang == "es" else "Services"],
            "services": services_es if lang == "es" else services_en,
            "policies": policies,
        }
        if featured:
            block["featured_package"] = featured
        return block

    client = {
        "public_slug": slug,
        "default_language": default_language,
        "brand_style": payload.get("brand_style", "warm-sand"),
        "business_name": str(payload.get("business_name", "")).strip()[:120],
        "logo_url": None,
        "primary_image_url": None,
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
