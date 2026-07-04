# First Client QA Checklist

Checklist obligatorio antes de publicar (y antes de entregar) la página de un
cliente real. Complementa el [QA_CHECKLIST.md](QA_CHECKLIST.md) general.

## Datos y privacidad (bloqueante)

- [ ] El JSON en `data/clients/` contiene SOLO información pública aprobada.
- [ ] Nada de la sección "qué no publicar" del intake aparece en la página.
- [ ] Sin correo interno, teléfono interno, `order_id`, datos de pago ni notas.
- [ ] Logos/fotos usados tienen permiso (autorización del intake marcada).
- [ ] La elección de visibilidad de precios se respetó en ambos idiomas.

## Bilingüe

- [ ] Existen las dos versiones: raíz (idioma por defecto) y subcarpeta alterna.
- [ ] El idioma por defecto coincide con lo que eligió el cliente en el intake.
- [ ] La traducción fue revisada por un humano (no solo literal).
- [ ] El switch de idioma funciona en ambas direcciones.
- [ ] `<html lang>` correcto en cada versión.
- [ ] canonical de cada página apunta a sí misma; hreflang es/en + x-default
      apuntan a las URLs correctas.

## Contenido

- [ ] Nombre del negocio, descripción, servicios, precios y horarios correctos.
- [ ] `brand_style` es el que el cliente eligió.
- [ ] Todos los botones abren el destino correcto (WhatsApp con el número
      público correcto, tel:, mailto:, Maps, Reviews, booking, redes).
- [ ] Sin botones rotos ni URLs de placeholder (EXAMPLE, 000…).
- [ ] Ortografía revisada en ambos idiomas.

## QR y URL

- [ ] `qr.svg` existe en la raíz del cliente y escanea a
      `https://www.hmulink.com/links/<slug>/`.
- [ ] La sección "Comparte esta página" muestra la URL por defecto en ambas
      versiones.
- [ ] La URL pública carga con HTTPS después del deploy.

## Layout

- [ ] Vista móvil correcta (~375px): sin overflow, botones tapeables.
- [ ] Imagen/logo se ven bien o el placeholder es digno (sin imagen rota).
- [ ] Página alterna carga el QR vía `../qr.svg` (imagen visible).

## Repo

- [ ] `git diff` solo toca `data/clients/<slug>.client.json` y
      `public/links/<slug>/`.
- [ ] Demos intactos.
- [ ] Workflows verdes tras el push; URL pública verificada en vivo.
