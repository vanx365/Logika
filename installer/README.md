# Instalador de Logika para Windows

Entrega al alumno `dist/LogikaSetup.exe`. El ejecutable genérico pregunta el origen del aula una vez, por ejemplo `https://logika.colegio.edu.pe`. Para una distribución institucional, compila el instalador con la dirección del centro para que ya venga seleccionada. El acceso **Logika** queda en el menú Inicio del usuario que ejecutó el instalador.

El instalador comprueba qué aplicación registró el protocolo `sebs`. Si ya está instalada la versión 3.10.3.960, crea el acceso al aula directamente. Si falta, descarga el Setup Bundle oficial desde la publicación 3.10.3, comprueba su SHA-256 y abre el asistente de SEB. La descarga pesa aproximadamente 402 MB. La instalación del cliente y de sus requisitos puede solicitar elevación o reinicio. El alumno acepta los términos directamente en el asistente oficial. La descarga requiere Internet. [Publicación oficial](https://github.com/SafeExamBrowser/seb-win-refactoring/releases/tag/v3.10.3)

Los alumnos abren **Logika** y entran en su aula. El botón **Empezar examen** utiliza el protocolo que SEB registra en Windows. El navegador habitual puede pedir permiso para abrir Safe Exam Browser. El perfil y las claves de validación se configuran en el servidor. Consulta la [guía del aula](../AULA.md).

## Compilar para un cliente

Desde PowerShell en Windows, con el compilador de .NET Framework 4.x disponible, ejecuta desde la raíz de Logika:

```powershell
.\installer\build.ps1 -Origin 'https://logika.colegio.edu.pe'
```

Sustituye el dominio por la dirección real de tu servicio. El artefacto se escribe en `installer/dist/LogikaSetup.exe`. Ejecutar el mismo script sin `-Origin` vuelve a generar el instalador genérico. Para probar en el mismo equipo que ejecuta el servidor se admite `http://localhost:3000`.

El ejecutable de este repositorio está sin firmar. Para distribución comercial, firma el instalador Logika con el certificado de firma de código de tu organización antes de publicarlo. Windows puede mostrar el aviso de editor desconocido y una política institucional de control de aplicaciones puede bloquear el ejecutable hasta que TI autorice el archivo o el firmante. El instalador oficial de SEB se obtiene por separado, conserva su identidad y se comprueba frente al digest publicado en GitHub.

## Actualización y desinstalación

Durante la verificación en el equipo de desarrollo, Windows Application Control bloqueó la carga del ensamblado sin firma con el código `0x800711C7`. En centros con una política equivalente, TI debe autorizar la versión distribuida o confiar en su firma. Verifica la instalación y la salida supervisada en un equipo del centro antes del primer examen.

La URL, versión requerida y huella del paquete oficial están en `LogikaSetup.cs`. Al cambiar de versión, verifica la nueva publicación y sus claves de examen antes de distribuir el instalador a los alumnos. Una versión instalada más reciente genera un aviso para el administrador, evitando un descenso de versión automático.

Para quitar el acceso de Logika, elimina **Logika.url** de la carpeta Programas del menú Inicio del usuario. SEB se administra desde **Aplicaciones instaladas** en Windows y puede seguir siendo necesario para otra institución.
