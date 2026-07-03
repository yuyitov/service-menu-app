# Data Contract — Service Menu App

Este documento define el contrato de datos entre las distintas etapas del flujo. Es la
fuente de verdad de qué campos existen, en qué etapa aparecen y qué forma tienen. Ningún
paso del pipeline debe inventar campos fuera de este contrato sin actualizarlo primero.

## Entidades

### 1. `service_menu_order`

Creada cuando el cliente paga vía Stripe Payment Link.

| Campo | Tipo | Notas |
|---|---|---|
| `order_id` | string | Identificador único del pedido. Fuente de idempotencia. |
| `payment_intent_id` | string | ID de Stripe, para reconciliación y evitar duplicados. |
| `customer_email` | string | Email del comprador. |
| `status` | enum | Ver [Estados posibles](#estados-posibles). |
| `created_at` | datetime (ISO 8601) | |
| `updated_at` | datetime (ISO 8601) | |

### 2. `service_menu_intake`

Respuesta del formulario Tally que el cliente llena post-pago.

| Campo | Tipo | Notas |
|---|---|---|
| `order_id` | string | Debe existir en `service_menu_order`. Requerido para aceptar el submission. |
| `business_name` | string | |
| `service_type` | string | Ej: "salon", "spa", "barbershop". |
| `short_description` | string | |
| `brand_style` | enum | Uno de los 6 estilos cerrados. Ver [Estilos visuales](#estilos-visuales-brand_style). |
| `primary_image_url` | string (URL) \| null | Opcional. Si ausente, el generador usa placeholder/template. |
| `logo_url` | string (URL) \| null | Opcional. Si ausente, el generador usa placeholder/template. |
| `service_categories` | array<string> | |
| `services` | array<object> | Ver estructura abajo. |
| `featured_package` | object \| null | Opcional. Ver estructura abajo. |
| `whatsapp` | string | Número en formato internacional. |
| `instagram` | string \| null | Opcional. |
| `google_maps_url` | string (URL) | |
| `address` | string | |
| `opening_hours_text` | string | Texto libre de horarios para MVP. Ver nota abajo. |
| `google_reviews_url` | string (URL) \| null | Opcional. |
| `policies` | array<string> | |

Estructura de `services[]`:

```json
{
  "category": "string",
  "name": "string",
  "description": "string (opcional)",
  "price_label": "string (opcional, ej. '$350 MXN', 'Desde $20 USD', 'Consultar')",
  "currency": "string (opcional, ej. USD)"
}
```

Estructura de `featured_package`:

```json
{
  "name": "string",
  "description": "string",
  "price_label": "string (opcional, ej. '$900 MXN', 'Desde $60 USD')",
  "currency": "string (opcional)"
}
```

`price_label` reemplaza a un `price` numérico: es un string libre para permitir rangos,
"desde", "consultar", o precios sin definir con precisión numérica, evitando forzar
validación/formato de moneda en el MVP.

**Horarios (MVP vs. post-MVP):** para el MVP, los horarios se capturan como
`opening_hours_text`, un string libre (ej. "Lun–Vie 9am–7pm, Sáb 10am–4pm, Dom cerrado").
La estructura horaria avanzada (`opening_hours[]` como array de objetos por día, con
`open`/`close` en `HH:MM`) queda documentada como **post-MVP**, para cuando se necesite
horario estructurado (ej. para integraciones futuras con Google Business Profile):

```json
// Post-MVP — no usar en el MVP actual
{
  "day": "mon | tue | wed | thu | fri | sat | sun",
  "open": "HH:MM (opcional, ausente = cerrado)",
  "close": "HH:MM (opcional)"
}
```

**Regla de imágenes ausentes:** si `primary_image_url` y/o `logo_url` no están presentes,
el generador de la página debe usar una imagen/placeholder de template por defecto, nunca
dejar la sección rota o vacía.

#### Estilos visuales (`brand_style`)

`brand_style` acepta **exactamente uno** de estos 6 estilos cerrados y aprobados. No se
permiten colores libres ni personalización fuera de esta lista: la personalización visual
es siempre por estilo cerrado, para mantener el producto automatizable y consistente.

| `brand_style` | Sensación | Ideal para | Paleta |
|---|---|---|---|
| `black-gold` | Premium, elegante, lujo | Spa premium, med spa, estética premium | Negro / azul-negro + crema cálido + dorado |
| `soft-blush` | Femenino, estético, delicado | Estéticas, lashes, brows, nails, faciales | Blush / nude rosado + café profundo / gris cálido |
| `charcoal-clean` | Sobrio, moderno, masculino, minimalista | Barberías, grooming, negocios masculinos | Gris carbón / negro suave + blanco hueso + gris claro |
| `warm-sand` | Cálido, cercano, boutique | Nails, salones, wellness cálido | Arena / beige / crema + terracota |
| `aqua-clean` | Limpio, fresco, moderno | Wellness, servicios neutrales, negocios modernos | Blanco / gris muy claro + aqua / turquesa |
| `sage-calm` | Natural, relajante, orgánico | Wellness, yoga, masajes, terapias holísticas | Salvia / marfil / verde suave |

`aqua-clean` reemplaza la idea previa de `clean-blue`. Los estilos base anteriores
(`clean` / `warm` / `premium`) quedan **obsoletos** y ya no son valores válidos.

### 3. `service_menu_payload_public`

Payload final, saneado, que consume el generador de la página pública (GitHub Actions →
GitHub Pages). Es un subconjunto/transformación de `service_menu_intake`, sin ningún dato
interno (sin `payment_intent_id`, sin `customer_email` completo, etc.).

| Campo | Tipo | Notas |
|---|---|---|
| `public_slug` | string | Slug único usado en la URL pública. |
| `business_name` | string | |
| `short_description` | string | |
| `brand_style` | enum | Uno de los 6 estilos cerrados. Ver [Estilos visuales](#estilos-visuales-brand_style). |
| `primary_image_url` | string (URL) \| null | Opcional. Ausente → placeholder/template. |
| `logo_url` | string (URL) \| null | Opcional. Ausente → placeholder/template. |
| `service_categories` | array<string> | |
| `services` | array<object> | Igual estructura que en el intake (con `price_label`). |
| `featured_package` | object \| null | |
| `whatsapp` | string | |
| `instagram` | string \| null | |
| `google_maps_url` | string (URL) | |
| `address` | string | |
| `opening_hours_text` | string | |
| `google_reviews_url` | string (URL) \| null | |
| `policies` | array<string> | |

### 4. `service_menu_delivery`

Registro de la entrega final al cliente.

| Campo | Tipo | Notas |
|---|---|---|
| `order_id` | string | |
| `public_slug` | string | |
| `public_url` | string (URL) | |
| `qr_asset_url` | string (URL) | URL del QR estático. Ver [QR estático](#qr-estatico-phase-2). |
| `delivered_at` | datetime (ISO 8601) | |
| `correction_token` | string | Token de un solo uso para la corrección incluida. |

#### QR estático (Phase 2)

- El QR se genera como **asset estático** (`qr.svg`) durante la generación de la página,
  junto al `index.html`: `public/demos/<slug>/qr.svg`. `qr_asset_url` apunta a ese archivo
  (conceptualmente `public_url` + `/qr.svg`).
- El QR codifica **exactamente el `public_url`** de la página. No es dinámico: se produce
  una vez al generar y no cambia salvo que se regenere la página.
- **Sin tracking**: el QR no pasa por ningún redireccionador ni añade parámetros de
  seguimiento; apunta directo al `public_url`.
- **Sin tokens privados**: el QR y la página pública nunca contienen `order_id`,
  `correction_token` ni ningún dato interno. Todo lo codificado es público.
- Formato **SVG** (vectorial, ligero, escalable e imprimible), generado con `segno`.

### 5. `service_menu_correction`

Registro de uso del link de corrección. La corrección incluida usa **campos controlados**,
no un objeto `changes` libre ni edición abierta del intake completo — esto mantiene el
flujo automatizable y evita requerir un dashboard o editor de propósito general.

| Campo | Tipo | Notas |
|---|---|---|
| `order_id` | string | |
| `correction_token` | string | Debe coincidir y no haber sido usado. Uso único. |
| `requested_at` | datetime (ISO 8601) | |
| `used_at` | datetime (ISO 8601) \| null | |
| `correction_notes` | string | Notas libres del cliente describiendo el cambio deseado. |
| `corrected_services_text` | string \| null | Opcional. Texto libre con los servicios/precios corregidos. |
| `corrected_hours_text` | string \| null | Opcional. Reemplazo de `opening_hours_text`. |
| `corrected_whatsapp` | string \| null | Opcional. |
| `corrected_instagram` | string \| null | Opcional. |
| `corrected_policies` | string \| null | Opcional. Texto libre con políticas corregidas. |

Cada campo `corrected_*` presente reemplaza directamente al campo equivalente del
`service_menu_intake` original al regenerar la página; los campos ausentes se dejan sin
cambio.

## Campos mínimos comunes (resumen)

`order_id`, `payment_intent_id`, `customer_email`, `business_name`, `service_type`,
`short_description`, `brand_style`, `primary_image_url` (opcional), `logo_url` (opcional),
`services` (con `price_label`), `service_categories`, `featured_package` (con
`price_label`), `whatsapp`, `instagram`, `google_maps_url`, `address`,
`opening_hours_text`, `google_reviews_url`, `policies`, `public_slug`, `public_url`,
`qr_asset_url`, `correction_token`, `status`, `created_at`, `updated_at`.

## Estados posibles

Aplican principalmente a `service_menu_order.status`, reflejando el avance del pedido a
través de todo el pipeline:

1. `paid` — pago confirmado por Stripe, aún sin intake.
2. `intake_sent` — email con el link de Tally fue enviado.
3. `intake_received` — el cliente completó el formulario Tally.
4. `generating` — GitHub Actions está generando la página.
5. `published` — página publicada en GitHub Pages.
6. `delivered` — email de entrega con link + QR enviado.
7. `correction_requested` — el cliente usó el link de corrección y envió cambios.
8. `correction_used` — la corrección fue aplicada y republicada; token ya inválido.
9. `failed` — algún paso del pipeline falló y requiere intervención manual.

Transiciones válidas (alto nivel):

```
paid → intake_sent → intake_received → generating → published → delivered
delivered → correction_requested → correction_used
(cualquier estado) → failed
```
