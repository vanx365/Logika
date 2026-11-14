import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

// Existing terminals may retain the PATH from before Docker was installed.
const desktopDocker = path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe");
const dockerCommand = process.platform === "win32" && existsSync(desktopDocker) ? desktopDocker : "docker";

const sessions = new Map();
const runtimes = {
  54: {
    file: "main.cpp",
    command: "g++ /source/main.cpp -o /work/main && exec /work/main",
  },
  71: { file: "main.py", command: "exec python3 -u /source/main.py" },
  62: {
    file: "Main.java",
    command:
      "javac -d /work /source/Main.java && exec java -XX:ActiveProcessorCount=1 -XX:MaxRAM=256m -cp /work Main",
  },
  63: { file: "main.js", command: "exec node /source/main.js" },
};

export function registerRunner(app) {
  app.post("/api/terminal/input", (req, res) => {
    const session = sessions.get(req.body.id);
    if (!session?.process || session.finished)
      return res.status(410).json({ error: "La ejecución ya terminó." });
    if (
      typeof req.body.input !== "string" ||
      Buffer.byteLength(req.body.input) > 4096
    )
      return res
        .status(400)
        .json({ error: "La entrada debe tener como máximo 4096 bytes." });
    if (
      !session.process.stdin.writable ||
      session.process.stdin.writableLength > 16384
    )
      return res
        .status(429)
        .json({ error: "Espera a que el programa lea los datos anteriores." });
    session.process.stdin.write(req.body.input + "\n", (error) => {
      if (error)
        return res.status(410).json({ error: "El programa cerró la entrada." });
      res.json({ ok: true });
    });
  });

  app.post("/api/terminal/cancel", (req, res) => {
    const session = sessions.get(req.body.id);
    session?.stop("Ejecución detenida.");
    res.json({ ok: true });
  });

  app.post("/api/terminal", async (req, res) => {
    const runtime = runtimes[req.body.language_id];
    if (!runtime || typeof req.body.code !== "string" || !req.body.code.trim())
      return res
        .status(400)
        .json({ error: "Escribe código y selecciona un lenguaje válido." });
    if (sessions.size >= 4)
      return res
        .status(429)
        .json({
          error:
            "Todos los ejecutores están ocupados. Intenta en unos segundos.",
        });
    const id = randomUUID();
    const name = "logika-" + id;
    const session = { process: null, finished: false, stop: () => {} };
    sessions.set(id, session);
    let directory;
    let timer;
    let totalBytes = 0;
    let runnerError = "";
    let stopReason = "";
    const emit = (event) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(JSON.stringify(event) + "\n");
    };
    const removeContainer = () => {
      const cleanup = spawn(dockerCommand, ["rm", "-f", name], {
        windowsHide: true,
        stdio: "ignore",
      });
      cleanup.on("error", () => {});
    };
    session.stop = (reason) => {
      if (session.finished) return;
      stopReason = reason;
      removeContainer();
      session.process?.kill();
    };
    res.on("close", () => session.stop("Conexión cerrada."));
    try {
      directory = await mkdtemp(path.join(tmpdir(), "logika-"));
      await chmod(directory, 0o755);
      await writeFile(path.join(directory, runtime.file), req.body.code);
      await chmod(path.join(directory, runtime.file), 0o644);
      if (res.destroyed) throw new Error("Conexión cerrada.");
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders();
      emit({ type: "start", id });
      const child = spawn(
        dockerCommand,
        [
          "run",
          "--rm",
          "--pull=never",
          "--name",
          name,
          "-i",
          "--network=none",
          "--memory=512m",
          "--memory-swap=512m",
          "--cpus=1",
          "--pids-limit=64",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--user=65534:65534",
          "--tmpfs",
          "/work:rw,exec,size=64m,mode=1777",
          "--tmpfs",
          "/tmp:rw,noexec,size=16m,mode=1777",
          "--mount",
          "type=bind,source=" + directory + ",target=/source,readonly",
          "logika-runner:local",
          "sh",
          "-c",
          runtime.command,
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      session.process = child;
      child.stdin.on("error", () => {});
      timer = setTimeout(
        () => session.stop("Se alcanzó el límite de 90 segundos."),
        90000,
      );
      for (const [type, stream] of [
        ["stdout", child.stdout],
        ["stderr", child.stderr],
      ]) {
        stream.setEncoding("utf8");
        stream.on("data", (text) => {
          totalBytes += Buffer.byteLength(text);
          if (totalBytes > 131072)
            return session.stop("Se alcanzó el límite de salida.");
          if (type === "stderr") runnerError += text;
          emit({ type, text });
        });
      }
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code));
      });
      session.finished = true;
      if (
        exitCode === 125 ||
        exitCode === 126 ||
        (exitCode === 127 && runnerError.includes("docker"))
      ) {
        emit({
          type: "error",
          message:
            /connect|daemon|pipe|engine/i.test(runnerError)
              ? "Docker está instalado, pero su motor no está disponible. Abre Docker Desktop. Si indica un problema de WSL o virtualización, completa esa configuración y reinicia Windows."
              : /No such image|Unable to find image/i.test(runnerError)
                ? "Falta la imagen de ejecución. Con Docker abierto, ejecuta npm run runner:build en la carpeta de Logika."
                : "Docker no pudo iniciar el entorno. Revisa el mensaje de la terminal y el estado de Docker Desktop.",
        });
      } else {
        emit({ type: "done", exitCode, message: stopReason });
      }
    } catch (error) {
      session.finished = true;
      const message =
        error.code === "ENOENT"
          ? "Instala y abre Docker Desktop con contenedores Linux. Después ejecuta npm run runner:build."
          : "No se pudo iniciar la terminal. Revisa Docker en el servidor.";
      emit({ type: "error", message });
    } finally {
      session.finished = true;
      clearTimeout(timer);
      sessions.delete(id);
      removeContainer();
      res.end();
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  });
}
