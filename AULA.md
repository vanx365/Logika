# Aula de Logika

## Probar una clase en este equipo

1. Desde la carpeta del proyecto, ejecuta `npm.cmd start` con Node.js 22.13 o posterior. Entra en [el aula local](http://localhost:3000/aula).
2. Elige **Crear una cuenta → Profesor**. Si dejaste vacía la variable `LOGIKA_TEACHER_INVITE`, el primer arranque crea una invitación aleatoria en `data/invitacion-docente.txt`. El administrador comparte esa invitación solo con los profesores. También puedes fijar tu propia invitación en la variable y reiniciar Logika.
3. Crea una clase y comparte su código con los alumnos. Publica un ejercicio indicando el enunciado, el lenguaje y la fecha y hora de cierre. El formulario muestra la zona horaria del equipo del profesor. Cada alumno ve el mismo instante convertido a su hora local.
4. Para probar como alumno en el mismo equipo, abre una ventana privada, crea una cuenta de alumno e introduce el código de la clase. Abre la tarea, escribe la solución y usa **Guardar borrador** para retomarla desde tu cuenta. **Ejecutar** abre la terminal interactiva de Docker. **Entregar solución** confirma la versión definitiva.
5. En **Revisar entregas**, el profesor ve quién entregó y cuándo. Puede leer el código entregado, asignar una nota entera de 0 a 20 y devolver un comentario. El alumno los ve al volver a su clase.

El servidor comprueba el vencimiento al guardar, ejecutar y entregar. Una entrega confirmada queda cerrada. Al vencer la tarea, el último borrador guardado sigue disponible para consulta y figura como **sin entrega**. La práctica libre con el tutor sigue disponible desde el laboratorio. Los ejercicios publicados usan el editor y la terminal del aula.

Las cuentas se crean con el correo declarado por la persona. Para una evaluación con nota, el profesor puede contrastar la lista de nombres y correos con su lista de matrícula.

## Preparar un examen para Windows

El cliente oficial de Safe Exam Browser (SEB) aplica las restricciones de escritorio en el equipo del alumno. Logika valida la versión y el perfil autorizados al abrir el enunciado, leer el borrador, ejecutar código y entregar. La comprobación utiliza la cabecera de examen de SEB para Windows. [Integración oficial](https://www.safeexambrowser.org/developer/seb-integration.html)

1. El centro entrega **LogikaSetup.exe** a los alumnos. El instalador obtiene el cliente oficial de Windows y crea un acceso directo al aula. En el equipo del administrador usa la misma versión y arquitectura que en los equipos de evaluación. SEB 3.10.3 distingue las Browser Exam Keys de x64 y x86. [Instalador de Logika](installer/dist/LogikaSetup.exe) · [Versión oficial de SEB](https://github.com/SafeExamBrowser/seb-win-refactoring/releases/tag/v3.10.3)
2. Para una clase real, publica Logika en una dirección HTTPS accesible desde los equipos de los alumnos. Usa un proxy HTTPS que conserve la ruta, la consulta y la cabecera `X-SafeExamBrowser-RequestHash`. Configura `LOGIKA_PUBLIC_ORIGIN` en el servidor con el origen exacto visible en los equipos, por ejemplo `https://logika.colegio.edu.pe`. Para probar en la misma PC que ejecuta Node, utiliza `http://localhost:3000`.
3. En la carpeta de Logika genera el perfil de preparación. El comando usa el origen de tu `.env`. También acepta un origen explícito como en el ejemplo siguiente.

   ```powershell
   npm.cmd run seb:preparar -- https://logika.colegio.edu.pe
   ```

   El comando crea una carpeta privada nueva dentro de `data`. Contiene `preparacion.seb` y `supervisor.txt`, con contraseñas distintas de administración y salida. El perfil abre `/aula`, solicita escritorio de examen y servicio SEB, usa pantalla completa y limita los recursos a las rutas del aula. El editor, los estilos y la terminal de esta vista se sirven desde Logika.
4. En **SEB Configuration Tool**, usa **Open Settings** para abrir `preparacion.seb`. La contraseña de administración está en `supervisor.txt`. Revisa **Applications**, **Network** y **Security** en el equipo donde evaluarás. En **Exam**, comprueba que esté activado el envío de la **Browser Exam Key** en la cabecera HTTP. En **Config File**, selecciona **starting an exam**, configura el cifrado de distribución y guarda el archivo final como `Logika-examen.seb`. Conserva la contraseña de salida con el supervisor hasta finalizar. [Manual de SEB para Windows](https://safeexambrowser.org/windows/win_usermanual_en.html)
5. Con el archivo final guardado, copia su **Browser Exam Key** desde **Exam** a `SEB_BROWSER_EXAM_KEYS` en el `.env` del servidor. Para admitir varias arquitecturas, obtén las claves con el mismo archivo final en cada instalación autorizada y sepáralas con comas. Si guardas otra configuración o actualizas SEB, vuelve a obtener las claves. Reinicia Logika.
6. Guarda el perfil final en un directorio privado del servidor y configura su ruta absoluta en `LOGIKA_SEB_PROFILE`. En el perfil nuevo debe estar activa **Allow Query Parameter**. Los centros con perfiles antiguos deben regenerarlos y actualizar sus claves. Para que los alumnos puedan entrar desde el acceso directo e iniciar el examen desde su navegador habitual, usa **`SEB_REQUIRE_APP=false`**. Reinicia el servidor y marca **Exigir Safe Exam Browser para Windows** al publicar la tarea. La opción global `true` se reserva para instalaciones que ya entran al aula desde SEB.
7. El alumno abre **Logika**, inicia sesión una vez y pulsa **Empezar examen**. El navegador puede pedir permiso para abrir Safe Exam Browser. SEB obtiene el perfil del servidor. Logika comprueba el pase de un solo uso y la cabecera de examen antes de abrir una sesión limitada a esa tarea. Si el pase caduca, el alumno puede volver a pulsar el botón en el aula. Al terminar, el supervisor puede autorizar la salida.

El perfil, el dominio y las claves de examen forman parte de la configuración de cada centro. Distribuye el instalador preparado para la URL de tu despliegue. Conserva las contraseñas de administración y salida en el centro. Para entrar sin una contraseña adicional de descifrado, el perfil debe poder abrirse sin intervención del alumno. Si el centro cifra el perfil con una identidad de certificado, debe aprovisionarla previamente en los equipos. Comprueba también que el proxy excluya los parámetros del pase de sus registros.

### Comprobar el equipo antes de evaluar

Con una cuenta de alumno y una tarea de prueba, pulsa **Empezar examen** desde un navegador común. Comprueba que SEB abre la tarea del alumno sin pedirle otra vez la cuenta. Ejecuta un programa con entrada, guarda y entrega. Comprueba en ese equipo que el acceso a otras aplicaciones y sitios queda restringido y que la salida del supervisor funciona. El alcance del control es la sesión de Windows en ese equipo.

Si SEB abre el aula pero el servidor pide el perfil otra vez, revisa el origen público, la arquitectura, la clave del archivo final y la cabecera en el proxy. Un examen protegido sigue exigiendo una validación correcta cuando faltan claves en el servidor.

## Uso comercial y licencias

Logika puede ofrecerse como servicio de pago que funciona con el cliente oficial de Safe Exam Browser. El instalador de Logika descarga el paquete publicado por SEB. Conserva su instalador y sus avisos originales. El código propio del aula, el tutor y el instalador se mantienen independientes. El manual de SEB documenta integraciones con plataformas comerciales. [Licencia incluida en SEB 3.10.3 para Windows](https://github.com/SafeExamBrowser/seb-win-refactoring/blob/v3.10.3/Setup/Resources/License.rtf) · [Manual de Windows](https://safeexambrowser.org/windows/win_usermanual_en.html)

La **Mozilla Public License 2.0** se aplica por archivo. Si distribuyes una versión que incorpora cambios a archivos cubiertos, debes conservar los avisos aplicables y facilitar a los destinatarios el código fuente cubierto, incluidos tus cambios. La integración de Logika con un cliente independiente permite mantener el código propio bajo la licencia que elijas. [MPL 2.0, secciones 3.1–3.4](https://www.mozilla.org/en-US/MPL/2.0/) · [Preguntas frecuentes de Mozilla](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

La distribución de Windows también incluye dependencias de terceros y un módulo de seguridad binario cuyo código fuente es cerrado. Si más adelante decides alojar tú mismo el paquete, modificarlo o distribuirlo bajo otra marca, revisa los términos de esos componentes y el uso de la marca. La sección 2.3 de la MPL reserva los derechos sobre marcas. Puedes describir el producto como **Logika, compatible con Safe Exam Browser**. [Componentes de SEB](https://safeexambrowser.org/about_overview_en.html) · [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/)

## Datos y pruebas

El aula conserva cuentas, clases, sesiones, borradores y calificaciones en SQLite. La ubicación predeterminada es `data/aula.sqlite`. Puedes elegir un directorio persistente con `LOGIKA_DATA_DIR`. La invitación generada y los perfiles se crean en el mismo directorio. Limita su acceso al administrador del servidor. Para una copia con el servicio detenido, conserva el directorio completo.

```powershell
npm.cmd run check
npm.cmd test
```

Las pruebas de integración crean datos y claves temporales y comprueban permisos, vencimiento, protección de exámenes, aislamiento de entregas y devolución de notas. La prueba del bloqueo del escritorio se realiza con el cliente instalado en Windows.
