# Analizador Correo — Respuestas y tiempos en buzón compartido

App **separada** (hermana de `whatsapp-analyzer`), sin dependencias. Analiza correos `.eml`
exportados de un buzón compartido de Outlook y reporta por **conversación (hilo)**:
quién solicita, quién responde, en cuánto tiempo y qué quedó pendiente.

Todo se procesa **en tu navegador, 100% local**. Ningún correo se sube a ningún servidor.

## Uso

1. En Outlook en la web: abre el buzón compartido y descarga los correos en formato `.eml`
   (⋯ > Descargar). Selecciona el período que quieras analizar.
2. Abre la app publicada en GitHub Pages (ver despliegue abajo) o `index.html` en local.
3. Arrastra los `.eml` o usa **Ver ejemplo** para probar.
4. Ajusta la **ventana de respuesta** (24h / 3d / 7d / 30d) y el filtro
   **Solo contar respuesta del equipo de soporte** + el roster sugerido.
5. Filtra por mes (múltiple), respondedor (múltiple), estado, rango, tema o búsqueda;
   abre el **detalle** de cada conversación y **exporta CSV/JSON**.

## Cómo se agrupa y se mide

- **Hilo** = correos con el mismo asunto (ignora Re:/Fwd:), con corte si hay más de
  7 días sin mensajes.
- **Solicitud** = primer correo del hilo. El remitente es el **solicitante**.
- **Respuesta** = primer correo posterior de otro remitente dentro de la ventana.
  Confianza **alta** si viene encadenado (`In-Reply-To`/`References`), **media** si no.
- **Pendiente** = nadie respondió dentro de la ventana.
- **Temas frecuentes** = palabras significativas de los asuntos, con su tiempo promedio.
- Los `.msg` de Outlook clásico aún no se aceptan: descarga como `.eml` desde la web.

## Despliegue (GitHub Pages)

No requiere compilación:

1. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` → carpeta `/ (root)` → Save.
2. La app queda en `https://<usuario>.github.io/outlook-analyzer/`.

## Desarrollo local

```powershell
# opción 1: abrir directo (funciona con file://)
start index.html

# opción 2: servidor local
npx serve .
```

## Archivos

| Archivo      | Qué hace                                                              |
| ------------ | --------------------------------------------------------------------- |
| `index.html` | Estructura + dashboard                                                |
| `styles.css` | Tema oscuro (compartido con whatsapp-analyzer)                        |
| `parser.js`  | Parser .eml + hilos + análisis (reutilizable: `require('./parser.js')`) |
| `app.js`     | UI, filtros, gráfica, CSV/JSON                                        |
