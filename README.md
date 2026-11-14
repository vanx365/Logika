# Logika

**Un tutor de programación que pregunta en lugar de responder.**

Logika es una aplicación web que ayuda a estudiantes de programación a razonar sus propias soluciones. En vez de entregar el código resuelto, usa el método socrático: hace preguntas guiadas, y el estudiante escribe, ejecuta y corrige su propio código.

> **Estado:** prototipo funcional (PMV) · Proyecto presentado en la Feria de Emprendimiento 2026 — Universidad La Salle, Arequipa.

---

## El problema

Los asistentes de IA generales resuelven un ejercicio en segundos. Para un estudiante de primeros ciclos esto es una trampa: entrega la tarea, pero **no desarrolla el razonamiento** que necesita para programar. Esta dependencia se conoce como *descarga cognitiva* (*cognitive offloading*), y es una preocupación creciente en la enseñanza de CS1.

## La solución

Logika actúa como un tutor y no como un generador de respuestas:

1. El estudiante recibe un problema y lo escribe en un editor de código.
2. Ejecuta su código en un entorno seguro y ve el resultado real.
3. Logika analiza su intento y responde con **preguntas** que lo llevan a descubrir el error o el siguiente paso.
4. El estudiante avanza con su propio razonamiento.

## Fundamento pedagógico

El diseño se apoya en tres ideas:

- **Especificación de intención** (*intent specification*): que el estudiante explique qué quiere que haga su código antes de escribirlo.
- **Descarga cognitiva en CS1**: reducir el atajo de pedirle la solución a la IA.
- **Pedagogía de programación resistente a la IA**: diseñar la interacción para que la IA acompañe el aprendizaje sin sustituirlo.

Inspirado en proyectos como **Maieutic**, adaptado al contexto de estudiantes de primeros ciclos y a la ejecución real de código.

## Características

- Editor de código integrado (Monaco Editor)
- Ejecución de código en sandbox (Judge0 CE)
- Tutor socrático impulsado por la API de Claude
- <!-- [COMPLETAR] Lenguajes soportados -->
- <!-- [COMPLETAR] Banco de ejercicios / niveles -->
- <!-- [COMPLETAR] Registro de progreso, si existe -->

## Arquitectura

```
┌────────────────────┐        ┌─────────────────────┐        ┌──────────────┐
│  Frontend          │  HTTP  │  Backend            │        │  Claude API  │
│  HTML / CSS / JS   │ ─────▶ │  Node.js + Express  │ ─────▶ │  (tutor      │
│  Monaco Editor     │ ◀───── │                     │ ◀───── │   socrático) │
└────────────────────┘        │                     │        └──────────────┘
                              │                     │        ┌──────────────┐
                              │                     │ ─────▶ │  Judge0 CE   │
                              │                     │ ◀───── │  (ejecución) │
                              └─────────────────────┘        └──────────────┘
```

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS, JavaScript, Monaco Editor |
| Backend | Node.js, Express |
| IA | Claude API (ingeniería de prompts) |
| Ejecución de código | Judge0 CE |

> La lógica del tutor se resuelve con ingeniería de prompts; no requiere fine-tuning.

## Instalación

Requisitos del equipo que ejecutará Logika:

- Node.js con npm y soporte para fetch y AbortSignal.timeout (Node.js 22 o posterior).
- Git.
- Docker Desktop con contenedores Linux en Windows o macOS, o Docker Engine en Linux. En Windows, WSL 2 y virtualización deben estar habilitados.
- Una clave propia de la API de Anthropic con acceso al modelo configurado y saldo o facturación disponibles.
- Conexión a Internet para descargar dependencias, construir la imagen y consultar al tutor.

Clona el repositorio y selecciona la rama Modificaciones. Desde su carpeta, en PowerShell:

```powershell
git switch Modificaciones
npm.cmd ci
Copy-Item .env.example .env
```

Edita el archivo .env y completa ANTHROPIC_API_KEY. Mantén ese archivo local.
Con Docker abierto y su motor funcionando:

```powershell
npm.cmd run runner:build
npm.cmd start
```

Abre http://localhost:3000. En macOS o Linux usa npm en lugar de npm.cmd y
cp .env.example .env para crear la configuración.

La construcción de la imagen se realiza una vez y se repite cuando cambia
Dockerfile.runner. En los siguientes arranques basta con iniciar Docker y
ejecutar npm.cmd start.

### Variables de entorno

| Variable | Descripción |
|---|---|
| ANTHROPIC_API_KEY | Clave propia del servicio de tutoría de Claude. La suscripción a su aplicación de chat y la API tienen facturación independiente. |
| PORT | Puerto del servidor, 3000 por defecto. |
| RAPIDAPI_KEY | Opcional, solo para el endpoint antiguo de Judge0. La terminal Docker no la usa. |

### Archivos del proyecto

- index.html, style.css y app.js contienen la interfaz.
- server.js conecta la interfaz con el tutor y registra las rutas.
- runner.js administra las terminales y los contenedores.
- Dockerfile.runner y .dockerignore definen la imagen de ejecución.
- package.json y package-lock.json definen comandos y dependencias.
- .env.example contiene nombres de variables sin credenciales.

## Hoja de ruta

- [x] Prototipo funcional con editor, ejecución y tutor socrático
- [ ] Validación con estudiantes reales
- [ ] <!-- [COMPLETAR] Siguiente funcionalidad -->
- [ ] <!-- [COMPLETAR] Panel para docentes, si es parte del plan -->

## Equipo

| Nombre | Rol |
|---|---|
| Edwin Sebastian Coaguila Suarez| <!-- [COMPLETAR] --> |

Estudiantes de Ingeniería de Software, Universidad de La Salle, Arequipa.

## Licencia

<!-- [COMPLETAR] Por ejemplo MIT, o "Todos los derechos reservados" -->
## Terminal interactiva con Docker

La interfaz ejecuta C++, Python, Java y JavaScript en contenedores Linux.
En el equipo que ejecuta el servidor instala Docker Desktop con WSL 2 (Windows)
o Docker Engine (Linux). Los alumnos acceden desde el navegador.

Con Docker en funcionamiento, prepara el entorno una vez:

```bash
npm ci
npm run runner:build
npm start
```

El botón Ejecutar abre una sesión de terminal. La salida aparece en vivo.
Si el programa lee datos con input(), cin, Scanner o stdin, escribe la respuesta
y pulsa Enter en la terminal. Los mensajes para solicitar datos deben estar
incluidos en el programa del estudiante. La terminal permite enviar líneas
mientras el proceso está activo; no intenta adivinar si el programa está leyendo.

Cada ejecución tiene un máximo de 90 segundos, 512 MB de memoria, una CPU,
64 procesos y 128 KiB de salida. El contenedor usa un usuario sin privilegios,
sin red y con el código montado como solo lectura. Detener el programa o
cerrar su conexión elimina el contenedor.

Después de terminar, Logika envía automáticamente al tutor una copia del
código ejecutado, las entradas y los resultados. Para limitar el contexto,
se envían hasta 8000 caracteres de entrada y 12000 de cada salida.
Una falla del tutor permite reintentar la revisión sin ejecutar otra vez.

ANTHROPIC_API_KEY sigue siendo necesaria para el tutor. La terminal Docker
no utiliza RAPIDAPI_KEY. El endpoint /api/run de Judge0 se conserva para
compatibilidad, pero la interfaz usa /api/terminal.

Si falta Docker, inicia Docker Desktop y construye la imagen con
npm run runner:build. Reinicia el servidor tras modificar su configuración.
Este servidor conserva sesiones en memoria; una instalación con varios
servidores necesita dirigir las solicitudes de una terminal al mismo proceso.
