# Intake → Client JSON — guía de conversión

Cómo convertir una submission de Tally en un `client_payload_public` v1 válido
(`data/clients/<slug>.client.json`). Complementa
[FIRST_CLIENT_RUNBOOK.md](FIRST_CLIENT_RUNBOOK.md) y
[CLIENT_PUBLIC_DATA_CHECKLIST.md](CLIENT_PUBLIC_DATA_CHECKLIST.md).

## Regla previa

El repo es público: **todo lo que entra al JSON se publica**. Antes de copiar
cualquier campo, pásalo por el checklist de datos públicos y por la sección
"qué no publicar" del intake del cliente.

## Paso a paso

1. **Copia la plantilla**: `data/clients/_template.client.json` →
   `data/clients/<slug>.client.json`. El slug: minúsculas, guiones, sin acentos,
   derivado del nombre del negocio (ej. "Bella Spa & Wellness" → `bella-spa`).
   Borra la clave `_comment`.

2. **Campos compartidos (no dependen del idioma)** — desde el intake:

   | JSON | Viene de (intake) | Notas |
   |---|---|---|
   | `public_slug` | nombre del negocio | tú lo defines |
   | `default_language` | "¿En qué idioma debe aparecer primero…?" | `es` o `en` |
   | `brand_style` | "Elige tu estilo" | slug del estilo (ej. `warm-sand`) |
   | `business_name` | Nombre del negocio | tal cual lo escribió |
   | `logo_url` / `primary_image_url` | uploads del intake | re-hospedar la imagen en un lugar público estable antes de referenciarla; `null` si no hay |
   | `whatsapp` | WhatsApp público | formato internacional |
   | `phone` | Teléfono público para llamadas | NO el interno 🔒 |
   | `public_email` | Correo público | NO el correo de vista previa 🔒 |
   | `instagram`/`facebook`/`tiktok`/`website` | Enlaces públicos | URLs completas https |
   | `booking_url` | Enlace externo de reservas | |
   | `google_maps_url` | Ubicación 1 — Google Maps | |
   | `google_reviews_url` | Enlace de Google Reviews | |

3. **Contenido por idioma** (`content.es` y `content.en`): el cliente llenó UN
   idioma; tú traduces y editas ligeramente el otro (autorizado en el intake).

   - `short_description` — descripción 1–2 frases.
   - `address` — dirección pública + notas de ubicación relevantes; para
     negocios sin local, el texto de "¿Dónde ofreces tus servicios?".
     Respetar si pidió mostrar solo colonia/zona.
   - `opening_hours_text` — horarios en texto libre, formato del idioma.
   - `service_categories` — orden de categorías.
   - `services[]` — `category`, `name`, `description` (opcional),
     `price_label` (opcional). Respetar la elección de **visibilidad de
     precios**: si eligió "no mostrar precios", omite `price_label`; si eligió
     "mixto", usa "Desde…"/"Consultar" (ES) o "From…"/"Ask us" (EN).
   - `featured_package` — o elimínalo si no dio ninguno.
   - `policies[]` — políticas + respuestas útiles de la sección por tipo de
     negocio (ej. "Solo con cita", "Cartilla de vacunación obligatoria").

4. **Lo que NUNCA entra al JSON**: correo interno, nombre de contacto interno,
   teléfono interno, "qué no publicar", notas finales privadas, `order_id`,
   datos de pago, adjuntos crudos de Tally.

5. **Campos del intake sin soporte aún** (guardarlos aparte, no en el repo):
   FAQ, fotos adicionales, botón principal, ubicaciones 2–3, botones de contacto
   seleccionados que no existan como campo. Ver "Campos futuros" en
   [DATA_CONTRACT.md](DATA_CONTRACT.md).

6. **Generar y verificar**:

   ```bash
   python generator/generate_service_menu.py --client data/clients/<slug>.client.json
   ```

   Salida: `public/links/<slug>/` (default) + `/en/` o `/es/` (alterno) +
   `qr.svg`. Pasar [FIRST_CLIENT_QA_CHECKLIST.md](FIRST_CLIENT_QA_CHECKLIST.md)
   antes de commitear.
