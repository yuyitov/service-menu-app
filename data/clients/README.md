# data/clients/ — payloads de clientes reales

Cada archivo `*.json` de esta carpeta es un `client_payload_public` (v1) y genera
una página bilingüe en `public/links/<public_slug>/`:

- Idioma por defecto → `public/links/<slug>/index.html`
- Idioma alterno → `public/links/<slug>/en/` (o `/es/`)
- Un solo QR → `public/links/<slug>/qr.svg`, apuntando a la URL del idioma por defecto

Los archivos que empiezan con `_` (como `_template.client.json`) son plantillas
y el generador los ignora.

## ⚠️ Regla de oro: este repo es PÚBLICO

Todo lo que entra en un JSON de esta carpeta se publica en internet. Antes de
crear o editar un archivo aquí:

1. Usa solo información pública **aprobada por el cliente** — ver
   [docs/CLIENT_PUBLIC_DATA_CHECKLIST.md](../../docs/CLIENT_PUBLIC_DATA_CHECKLIST.md).
2. Nunca incluyas: correo interno de contacto, teléfono interno, notas privadas,
   la sección "qué no publicar" del intake, datos de pago, `order_id`, ni datos
   de Tally.
3. Sigue [docs/INTAKE_TO_CLIENT_JSON_GUIDE.md](../../docs/INTAKE_TO_CLIENT_JSON_GUIDE.md)
   para convertir una submission de Tally en un JSON válido.

## Generar

```bash
python generator/generate_service_menu.py                      # demos + todos los clientes
python generator/generate_service_menu.py --client data/clients/mi-cliente.json
```
