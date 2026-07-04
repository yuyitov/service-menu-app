# First Client Runbook — flujo manual (Phase 5A-prep)

Proceso manual para atender al **primer cliente real** de HMU Link de forma segura,
antes de que exista Stripe, Worker, KV, emails automáticos o cualquier backend.
Todo lo de este documento se hace a mano; ningún paso depende de automatización.

Los leads llegan por los formularios de intake publicados:

- Inglés: https://tally.so/r/yPkN5X (CTAs del sitio con `?source=hmu_website_en`)
- Español: https://tally.so/r/MeyDpk (CTAs del sitio con `?source=hmu_website_es`)

## Flujo paso a paso

**A. Llega el lead por Tally.**
Revisar la submission en el dashboard de Tally (no hay notificación automática en
esta fase: revisar manualmente al menos 1 vez al día).

**B. Revisar la submission completa.**
Verificar que tenga lo mínimo para construir la página: nombre del negocio, tipo,
descripción, servicios con precios, horarios, al menos un medio de contacto público
y estilo elegido. Verificar que las 3 casillas de autorización estén marcadas.
Si falta algo esencial, contactar al cliente por su **contacto interno** (correo o
teléfono de la sección 🔒) — nunca por los datos públicos si dio unos distintos.

**C. Confirmar paquete y precio manualmente.**
Por correo o WhatsApp, confirmar por escrito: qué incluye (1 página, 1 estilo,
QR, 1 corrección incluida), el precio acordado y que es pago único. El precio de
la landing es tentativo; lo acordado por escrito manda.

**D. Cobrar manualmente.**
Seguir [PILOT_PAYMENT_AND_DELIVERY.md](PILOT_PAYMENT_AND_DELIVERY.md):
transferencia o efectivo; nunca datos de tarjeta a mano; nada de pagos al repo.
En esta fase **no** hay Stripe ni checkout en el sitio, y el formulario **no**
cobra nada. No empezar a construir hasta tener el pago (o una decisión explícita
de hacer el primer piloto gratis/descuento — dejar constancia por escrito).
Mensajes listos para cada paso en [SALES_MESSAGES.md](SALES_MESSAGES.md).

**E. Extraer solo la información pública.**
Usar [CLIENT_PUBLIC_DATA_CHECKLIST.md](CLIENT_PUBLIC_DATA_CHECKLIST.md). El correo
interno, el teléfono interno, las notas privadas y la sección "qué no publicar"
**nunca** pasan al JSON ni al repo.

**F. Traducir y editar ligeramente.**
Producir la versión en el otro idioma (EN↔ES) respetando el tono del cliente.
La autorización de traducción ya viene firmada en el intake.

**G. Crear el JSON del cliente solo con información pública aprobada.**
Copiar `data/clients/_template.client.json` → `data/clients/<slug>.client.json`
y llenarlo siguiendo [INTAKE_TO_CLIENT_JSON_GUIDE.md](INTAKE_TO_CLIENT_JSON_GUIDE.md)
(esquema `client_payload_public` v1 en [DATA_CONTRACT.md](DATA_CONTRACT.md)).
Incluye el contenido en **ambos idiomas** (`content.es` + `content.en`) y el
`default_language` que eligió el cliente. Respetar la lista de "qué no
publicar" del intake al pie de la letra.

**H. Generar la página bilingüe.**
`python generator/generate_service_menu.py --client data/clients/<slug>.client.json`
Salida: `public/links/<slug>/` (idioma por defecto) + `/en/` o `/es/` (alterno)
+ `qr.svg` apuntando a la URL por defecto.

**I. Revisar localmente.**
Pasar [FIRST_CLIENT_QA_CHECKLIST.md](FIRST_CLIENT_QA_CHECKLIST.md) completo:
ambos idiomas, switch de idioma, botones, QR, canonical/hreflang, móvil,
sin datos internos visibles, sin errores de ortografía.

**J. Publicar.**
Commit + push → workflows → verificar la URL pública en www.hmulink.com.

**K. Enviar vista previa y QR.**
Al **correo interno** del cliente: link público + QR + recordatorio de que tiene
una corrección incluida.

**L. Recibir la corrección incluida (una).**
Aplicarla sobre el JSON, regenerar, republicar. Cambios extra se cotizan aparte.

**M. Publicar la versión final y cerrar.**
Confirmar con el cliente que todo está correcto. Guardar registro (fecha, paquete,
precio cobrado, correcciones usadas) fuera del repo.

## Reglas de seguridad estrictas

- **Nunca** commitear al repo: correos internos, teléfonos internos, notas
  privadas, información de pago, ni ningún dato privado del cliente.
- Al JSON público y a las páginas solo entra información pública de negocio.
- Ante la duda de si algo es público: **preguntar al cliente primero**.
- Logos, fotos y testimonios subidos deben tener permiso de publicación (viene
  en la autorización del intake; si algo parece de terceros, confirmar).
- Jamás pedir ni almacenar: expedientes médicos, contraseñas, identificaciones
  oficiales, ni datos privados de los clientes finales del negocio.
- Los archivos exportados de Tally (CSV, adjuntos) viven fuera del repo.
