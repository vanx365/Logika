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

> Ajusta los comandos a tu repositorio si difieren.

```bash
# 1. Clonar el repositorio
git clone <URL-DEL-REPOSITORIO>
cd logika

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus claves (ver abajo)

# 4. Iniciar el servidor
npm start
```

Abre `http://localhost:3000` <!-- [COMPLETAR] confirma el puerto -->.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API de Claude |
| `JUDGE0_URL` | URL de la instancia de Judge0 CE <!-- [COMPLETAR] nombre exacto de la variable --> |
| `PORT` | Puerto del servidor (opcional) |

**Nunca subas tu archivo `.env` al repositorio.**

## Estructura del proyecto

<!-- [COMPLETAR] Pega aquí el árbol real del repo, por ejemplo: -->
```
logika/
├── public/        # frontend (HTML, CSS, JS)
├── server/        # backend Express
├── .env.example
├── CLAUDE.md
└── README.md
```

## Hoja de ruta

- [x] Prototipo funcional con editor, ejecución y tutor socrático
- [ ] Validación con estudiantes reales
- [ ] <!-- [COMPLETAR] Siguiente funcionalidad -->
- [ ] <!-- [COMPLETAR] Panel para docentes, si es parte del plan -->

## Equipo

| Nombre | Rol |
|---|---|
| Edwin Sebastian Coaguila (Vanx) | <!-- [COMPLETAR] --> |

Estudiantes de Ingeniería de Software, Universidad de La Salle, Arequipa.

## Licencia

<!-- [COMPLETAR] Por ejemplo MIT, o "Todos los derechos reservados" -->