# Logika

**Un tutor de programación que pregunta en lugar de responder.**

Logika es una aplicación web para que los estudiantes de programación razonen sus propias soluciones. El estudiante plantea primero su plan, un tutor con IA lo cuestiona con preguntas y solo después se abre el editor. Además incluye un **aula** donde el docente asigna ejercicios, recibe entregas y califica.

> **Estado:** prototipo funcional (MVP) · Proyecto presentado en la Feria de Emprendimiento 2026 y en la Feria Concurso de Proyectos Digitales 2026 de la Universidad La Salle, Arequipa.

---

## El problema

Los asistentes de IA generales resuelven un ejercicio en segundos. Para un estudiante de primeros ciclos esto es una trampa: entrega la tarea, pero **no desarrolla el razonamiento** que necesita para programar. Esta dependencia se conoce como *descarga cognitiva* (*cognitive offloading*) y preocupa a quienes enseñan programación en los primeros cursos. Además, el docente no puede ver cómo pensó cada alumno.

## La solución

Logika invierte el orden habitual: **primero piensas, después programas.**

1. **Plantea:** el estudiante escribe el enunciado y su plan con sus propias palabras.
2. **Dialoga:** el tutor responde con una pregunta a la vez y no da la solución. El editor se abre cuando el plan es sólido.
3. **Programa y entrega:** el estudiante escribe y ejecuta su código en una terminal real. El tutor revisa el resultado con preguntas, y en el aula el docente recibe la entrega y la califica.

## Fundamento pedagógico

- **Especificación de intención** (*intent specification*): explicar qué debe hacer el programa antes de escribirlo.
- **Descarga cognitiva en CS1**: reducir el atajo de pedirle la solución a la IA.
- **Pedagogía de programación resistente a la IA**: diseñar la interacción para que la IA acompañe el aprendizaje sin sustituirlo.

Inspirado en proyectos como **Maieutic**, y adaptado a estudiantes de primeros ciclos y a la ejecución real de código.

## Características

- **Tutor socrático** con la API de Claude: una pregunta por mensaje, sin entregar la solución.
- **Terminal interactiva con Docker:** ejecuta C++, Python, Java y JavaScript en contenedores aislados.
- **Aula:** cuentas de profesor y alumno, clases por código, ejercicios con fecha de cierre, borradores, entregas, calificación de 0 a 20 y comentarios.
- **Modo examen en Windows** con Safe Exam Browser: el docente puede exigirlo por tarea.
- **Pruebas automatizadas** de permisos, vencimientos, calificación y acceso a exámenes.

## Arquitectura

```
┌────────────────────┐        ┌─────────────────────┐        ┌──────────────┐
│  Frontend          │  HTTP  │  Backend            │ ─────▶ │  Claude API  │
│  HTML / CSS / JS   │ ─────▶ │  Node.js + Express  │ ◀───── │  (tutor)     │
│  Monaco Editor     │ ◀───── │                     │        └──────────────┘
└────────────────────┘        │                     │        ┌──────────────┐
                              │                     │ ─────▶ │  Docker      │
                              │                     │ ◀───── │  (terminal)  │
                              │                     │        └──────────────┘
                              │                     │        ┌──────────────┐
                              │                     │ ─────▶ │  SQLite      │
                              └─────────────────────┘        │  (aula)      │
                                                             └──────────────┘
```

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS, JavaScript, Monaco Editor |
| Backend | Node.js, Express |
| IA | API de Claude (ingeniería de prompts) |
| Ejecución de código | Docker (contenedores Linux sin red) |
| Aula | SQLite (módulo `node:sqlite`) |
| Exámenes | Safe Exam Browser |

## Instalación

Requisitos del equipo que ejecutará Logika:

- Node.js 22.13 o posterior, con npm.
- Git.
- Docker Desktop (Windows o macOS) o Docker Engine (Linux). En Windows, WSL 2 y la virtualización deben estar habilitados.
- Una clave propia de la API de Anthropic, con saldo disponible.

Desde PowerShell, en la carpeta del proyecto:

```powershell
git switch Modificaciones
npm.cmd ci
Copy-Item .env.example .env
```

Edita `.env` y completa `ANTHROPIC_API_KEY`. Ese archivo es local y no se sube a GitHub. Con Docker abierto:

```powershell
npm.cmd run runner:build
npm.cmd start
```

Abre <http://localhost:3000>. En macOS o Linux usa `npm` en lugar de `npm.cmd` y `cp .env.example .env`. La imagen se construye una vez y se repite solo si cambia `Dockerfile.runner`.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API para el tutor. |
| `PORT` | Puerto del servidor (3000 por defecto). |
| `LOGIKA_TEACHER_INVITE` | Invitación para crear cuentas de profesor. Si queda vacía, se genera una en `data/invitacion-docente.txt`. |
| `LOGIKA_PUBLIC_ORIGIN` | Dirección pública exacta de Logika (para exámenes con Safe Exam Browser). |
| `SEB_BROWSER_EXAM_KEYS`, `SEB_REQUIRE_APP`, `LOGIKA_SEB_PROFILE` | Configuración de Safe Exam Browser. Ver [AULA.md](AULA.md). |
| `RAPIDAPI_KEY` | Opcional. Solo para el endpoint antiguo de Judge0; la terminal Docker no la usa. |

### Límites de la terminal

Cada ejecución tiene un máximo de 90 segundos, 512 MB de memoria, una CPU, 64 procesos y 128 KiB de salida. El contenedor corre sin privilegios, sin red y con el código en solo lectura.

## Aula y exámenes

Abre **Mis clases** desde el laboratorio o entra en `/aula`. La guía de primer acceso del profesor y la preparación de Safe Exam Browser está en [AULA.md](AULA.md). El instalador para Windows está en [installer/README.md](installer/README.md).

## Pruebas

```bash
npm run check   # revisa la sintaxis de los archivos
npm test        # ejecuta las pruebas automatizadas
```

## Privacidad y datos personales

El aula guarda nombre, correo y entregas. Consulta el [Aviso de privacidad](AVISO_PRIVACIDAD.md), elaborado conforme a la Ley N.° 29733 de Protección de Datos Personales.

## Validación

52 estudiantes probaron Logika de manera informal durante el desarrollo. La mayoría opinó que la idea era buena y que la interfaz era buena y simple. Todavía no se midió con una encuesta formal ni con docentes: el aula y el modo examen son recientes.

## Uso de inteligencia artificial

Logika usa la API de Claude (Anthropic) como motor del tutor. Durante el desarrollo, el equipo usó Claude para aprender a integrar librerías y, por falta de tiempo, también generó parte del código del proyecto.

## Hoja de ruta

- [x] Prototipo funcional con tutor, editor y terminal
- [x] Aula con entregas y calificación
- [x] Modo examen con Safe Exam Browser
- [x] Validación formal con encuesta y consentimiento
- [ ] Que el docente vea los intentos y el razonamiento del estudiante (plan y diálogo con el tutor) dentro del aula

## Equipo

| Nombre | Rol |
|---|---|
| Edwin Sebastian de Jesus Coaguila Suarez | Ideas, coordinación del equipo y frontend |
| Cesar Gustavo Hilguiera Apaza | Backend |
| Jasser Carbajal Sequeiros | Pitch y presentación del proyecto |

Estudiantes de Ingeniería de Software, Universidad de La Salle, Arequipa.

## Licencia

<!-- [COMPLETAR] Por ejemplo MIT, o "Todos los derechos reservados" -->
