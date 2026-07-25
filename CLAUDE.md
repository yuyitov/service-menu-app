# HMU Link (service-menu-app) — notas para Claude

> Archivo mínimo. La documentación de fondo (roadmap, plan de ventas) vive en el repo hermano `service-menu-app-private-docs`.

## Sincroniza pendientes con el tablero central

Los pendientes de HMU Link están centralizados en el business-dashboard: `C:\Users\veron\Negocios Digitales\Dashboard\business-dashboard\config\pendientes.json`, bajo el área `"hmuLink"`.

**Al cerrar una tarea que esté listada ahí como pendiente, márcala hecha** antes de terminar la sesión: en ese archivo ubica el área `"hmuLink"`, encuentra el ítem por su `"n"` y agrégale `"hecho": true`. No borres ni renumeres los demás ítems, y no inventes pendientes nuevos (si lo que hiciste no está en la lista, déjalo). Con eso desaparece de los dos tableros: el business-dashboard al recargar y el de Charly al reabrirlo. Si el business-dashboard corre en `127.0.0.1:4545`, equivale a `POST /api/pendientes/done` con `{ "areaId": "hmuLink", "n": <n>, "hecho": true }`.
