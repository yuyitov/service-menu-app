"""Verify the semantic content of generated client QR PNG assets.

PNG compression bytes can differ between supported operating systems.  This
checker deliberately verifies the QR module matrix instead: every module must
match the deterministic Segno matrix for the client's public URL.
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

import segno


ROOT = Path(__file__).resolve().parent.parent
CLIENT_DATA = ROOT / "data" / "clients"
PUBLIC_LINKS = ROOT / "public" / "links"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SCALE = 8
BORDER = 2


class QrVerificationError(ValueError):
    """Raised when a committed client QR cannot be proven correct."""


def _png_rows(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise QrVerificationError(f"{path}: no es un PNG válido")

    offset = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = None
    compressed = bytearray()
    palette: bytes | None = None

    while offset < len(data):
        if offset + 12 > len(data):
            raise QrVerificationError(f"{path}: chunk PNG truncado")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        if offset + 12 + length > len(data):
            raise QrVerificationError(f"{path}: chunk PNG inválido")
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(
                ">IIBBBBB", chunk
            )
        elif kind == b"PLTE":
            palette = chunk
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break

    if (bit_depth, color_type) != (1, 3) or not width or not height:
        raise QrVerificationError(f"{path}: formato PNG QR no soportado")
    if palette is None or len(palette) < 6:
        raise QrVerificationError(f"{path}: paleta PNG QR ausente")

    # Segno writes a two-colour indexed image: entry 0 must be the dark module
    # and entry 1 the light background. Refuse to validate an inverted or
    # unexpected palette rather than silently accepting an unreadable QR.
    if sum(palette[:3]) >= sum(palette[3:6]):
        raise QrVerificationError(f"{path}: paleta QR inesperada")

    stride = (width + 7) // 8
    raw = zlib.decompress(bytes(compressed))
    if len(raw) != height * (stride + 1):
        raise QrVerificationError(f"{path}: tamaño de píxeles PNG inválido")

    rows: list[bytes] = []
    previous = bytes(stride)
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        encoded = raw[cursor + 1 : cursor + 1 + stride]
        cursor += stride + 1
        row = bytearray(stride)
        for index, value in enumerate(encoded):
            left = row[index - 1] if index else 0
            above = previous[index]
            upper_left = previous[index - 1] if index else 0
            if filter_type == 0:
                row[index] = value
            elif filter_type == 1:
                row[index] = (value + left) & 0xFF
            elif filter_type == 2:
                row[index] = (value + above) & 0xFF
            elif filter_type == 3:
                row[index] = (value + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                prediction = left + above - upper_left
                distances = (abs(prediction - left), abs(prediction - above), abs(prediction - upper_left))
                paeth = left if distances[0] <= distances[1] and distances[0] <= distances[2] else (above if distances[1] <= distances[2] else upper_left)
                row[index] = (value + paeth) & 0xFF
            else:
                raise QrVerificationError(f"{path}: filtro PNG no soportado")
        rows.append(bytes(row))
        previous = bytes(row)
    return width, height, rows


def _pixel(rows: list[bytes], x: int, y: int) -> int:
    return (rows[y][x // 8] >> (7 - (x % 8))) & 1


def verify_qr_png(path: Path, public_url: str) -> None:
    width, height, rows = _png_rows(path)
    qr = segno.make(public_url, error="m")
    matrix = qr.matrix
    modules = len(matrix)
    expected_size = (modules + 2 * BORDER) * SCALE
    if (width, height) != (expected_size, expected_size):
        raise QrVerificationError(
            f"{path}: tamaño {width}x{height}; se esperaba {expected_size}x{expected_size}"
        )

    for row_index in range(modules + 2 * BORDER):
        for column_index in range(modules + 2 * BORDER):
            expected_dark = (
                BORDER <= row_index < modules + BORDER
                and BORDER <= column_index < modules + BORDER
                and bool(matrix[row_index - BORDER][column_index - BORDER])
            )
            actual_dark = _pixel(
                rows,
                column_index * SCALE + SCALE // 2,
                row_index * SCALE + SCALE // 2,
            ) == 0
            if actual_dark != expected_dark:
                raise QrVerificationError(
                    f"{path}: módulo QR incorrecto en fila {row_index}, columna {column_index}"
                )


def verify_all_clients() -> int:
    checked = 0
    for payload_path in sorted(
        path for path in CLIENT_DATA.glob("*.client.json") if not path.name.startswith("_")
    ):
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        slug = str(payload["public_slug"])
        public_url = f"https://www.hmulink.com/links/{slug}/"
        verify_qr_png(PUBLIC_LINKS / slug / "qr.png", public_url)
        checked += 1
    if not checked:
        raise QrVerificationError("No se encontraron payloads de clientes para comprobar")
    return checked


if __name__ == "__main__":
    try:
        total = verify_all_clients()
    except (OSError, ValueError, zlib.error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"OK: {total} QR PNG de clientes codifican su URL pública correcta.")
