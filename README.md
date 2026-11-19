# Logika

Logika es un laboratorio de programación en español para estudiantes que están aprendiendo a convertir una idea en código. El estudiante explica cómo resolvería un problema, conversa con un tutor de IA y, cuando el tutor aprueba su plan, pasa al editor. Después de ejecutar el programa, puede comparar lo que esperaba con lo que ocurrió usando su propio código, las entradas y la salida de la terminal.

El proyecto también incluye un aula donde los profesores publican ejercicios y califican entregas. Es un prototipo de estudiantes de Ingeniería de Software de la Universidad La Salle, Arequipa, presentado en la Feria de Emprendimiento 2026 y en la Feria Concurso de Proyectos Digitales 2026.

## Probar el laboratorio

1. Abre el laboratorio y pulsa **Usar un ejemplo** o escribe tu propio enunciado. Elige **C++, Python, Java o JavaScript**.
2. Explica tu estrategia en el chat. El tutor hace preguntas sobre el plan y, al aprobarlo, habilita el editor. Puedes volver a consultar la estrategia mientras programas.
3. Escribe tu solución y pulsa **Ejecutar**. Si el programa pide datos, introdúcelos en la terminal. Al terminar, el tutor recibe el código, las entradas y los resultados para ayudarte a revisar el intento.
4. Pulsa **Nuevo ejercicio** para empezar con un borrador y una conversación nuevos.

## Usar el aula

| Quién | Qué puede hacer |
| --- | --- |
| **Profesor** | Registrarse con una invitación docente, crear una clase y compartir su código. Puede publicar tareas con lenguaje y hora de cierre, revisar el código entregado, calificar de 0 a 20 y dejar comentarios. |
| **Alumno** | Unirse con el código de clase, guardar borradores, probar el programa con la terminal y entregar su solución. Puede consultar la nota y los comentarios desde la misma clase. |

El servidor controla el plazo. Al cerrar una tarea, un borrador guardado sigue disponible para consulta y figura como **sin entregar**. Para probar ambos roles en una computadora, abre la sesión del profesor en una ventana normal y la del alumno en una privada. [Guía del aula](AULA.md)

### Exámenes en Windows

El profesor puede activar **Exigir Safe Exam Browser para Windows** en una tarea. El alumno instala Logika una vez, entra en su clase y pulsa **Empezar examen**. El navegador puede pedir permiso para abrir Safe Exam Browser (SEB). Logika usa un pase de un solo uso para abrir la tarea con la sesión del alumno.

El administrador prepara el perfil de SEB y registra su *Browser Exam Key* en el servidor. Con el enlace de salida configurado, Logika solicita el cierre de SEB cuando se confirma la entrega o vence el plazo. Para usar el aula desde otras computadoras, el centro debe proporcionar su dirección HTTPS. El instalador de Windows configura el acceso a esa dirección y obtiene el cliente oficial de SEB cuando hace falta. [Configuración de exámenes](AULA.md#preparar-un-examen-para-windows) · [Instalador para Windows](installer/README.md)

## Ejecutar Logika en tu equipo

Necesitas **Git, Node.js 22.13 o posterior y npm**. La terminal requiere **Docker con contenedores Linux** en el equipo que ejecuta el servidor. El tutor requiere una clave de la API de Anthropic. El aula permite crear clases, publicar tareas y calificar con la clave de IA vacía.

Desde PowerShell, para una instalación nueva:

```powershell
git clone https://github.com/vanx365/Logika.git
cd Logika
npm.cmd ci
Copy-Item .env.example .env
```

Para usar el tutor, completa `ANTHROPIC_API_KEY` en `.env`. Inicia Docker y ejecuta:

```powershell
npm.cmd run runner:build
npm.cmd start
```

La imagen se construye en la primera instalación y cuando cambia `Dockerfile.runner`. En los siguientes arranques, inicia Docker y ejecuta `npm.cmd start`. En macOS o Linux usa `npm` y copia la configuración con `cp .env.example .env`.

Con el puerto predeterminado puedes abrir el [laboratorio](http://localhost:3000/) y el [aula](http://localhost:3000/aula). Para crear la primera cuenta de profesor, consulta `data/invitacion-docente.txt`, generado en el primer arranque. Puedes fijar tu propia invitación con `LOGIKA_TEACHER_INVITE`. El alumno recibe el código de clase que genera el profesor.

## Tecnología y datos

- **Interfaz y servidor.** HTML, CSS y JavaScript, Monaco Editor en el laboratorio y una API de Node.js con Express.
- **Tutor.** El servidor envía el contexto del ejercicio a la API de Claude. El laboratorio conserva el borrador y la conversación del ejercicio en el navegador.
- **Terminal.** Cada ejecución usa un contenedor Docker sin acceso a la red, con un límite de 90 segundos y 512 MB de memoria. Docker se instala en el servidor. La interfaz usa esta terminal. La variable `RAPIDAPI_KEY` solo corresponde a la ruta de compatibilidad con Judge0.
- **Aula.** SQLite guarda cuentas, clases, borradores, entregas y calificaciones en `data/aula.sqlite`. El registro del aula incluye un aviso de privacidad y guarda la fecha y versión aceptada. La configuración privada y los datos locales se excluyen de Git. [Variables de configuración](.env.example) · [Aviso de privacidad del proyecto](https://github.com/vanx365/Logika/blob/main/Aviso%20de%20Privacidad)

Para revisar la sintaxis y ejecutar las pruebas automatizadas:

```sh
npm run check
npm test
```

Las pruebas cubren permisos por rol, plazos, calificaciones, acceso a exámenes y separación del historial entre ejercicios. El bloqueo y la salida de SEB se comprueban con el cliente instalado en Windows.

## Equipo y experiencia inicial

| Integrante | Aporte |
| --- | --- |
| Edwin Sebastian de Jesus Coaguila Suarez | Idea, coordinación del equipo y frontend |
| Cesar Gustavo Hilguiera Apaza | Backend |
| Jasser Carbajal Sequeiros | Pitch y presentación del proyecto |

El equipo reporta que **52 estudiantes** probaron Logika de manera informal durante el desarrollo. Sus comentarios iniciales se refirieron a la idea y a la sencillez de la interfaz. Durante el desarrollo, el equipo también utilizó Claude para aprender a integrar bibliotecas y generar parte del código.
