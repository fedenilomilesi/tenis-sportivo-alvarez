# Tenis Sportivo Fútbol Club de Álvarez

Sistema web oficial de reserva de canchas de tenis (Cancha 1 y Cancha 2).

## Características principales
- Turnos oficiales de 90 minutos (de 14:00 a 23:00 hs).
- Prioridad profesores (Jarno Cefarelli y Leonardo Albertoli) a partir de las 20:00 hs del día anterior y múltiples turnos.
- Socios generales: reserva a partir de las 21:00 hs del día anterior (máximo 1 turno por día).
- Cruce automático de DNI con el padrón de socios del club.
- No socios: solicitud de reserva provisional con ventana de 5 minutos para subir comprobante de transferencia bancaria al club.
- Panel de estadísticas y detección de patrones de bloqueo de turnos.
- Diseño mobile-first optimizado para celulares.

## Despliegue en Render / Railway / Vercel

### Para Render.com (Recomendado, gratuito con Node.js backend):
1. Crear cuenta en [render.com](https://render.com).
2. Conectar repositorio de GitHub o subir la carpeta.
3. Build Command: (dejar vacío o `npm install`)
4. Start Command: `node server.js`
5. El sistema asignará una URL pública gratuita tipo: `https://tenis-sportivo-alvarez.onrender.com`

### Variables de entorno:
- `PORT`: asignado automáticamente por la plataforma (por defecto 3000).
