import { registerRunner } from "./runner.js";
import { classroom } from "./classroom.js";
import { examPolicy } from "./seb.js";
import { respondWithTutor } from "./tutor.js";
import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const directory = path.dirname(fileURLToPath(import.meta.url));
const seb = examPolicy(process.env);
app.get("/descargas/LogikaSetup.exe", (req, res) => {
  res.download(path.join(directory, "installer", "dist", "LogikaSetup.exe"), "LogikaSetup.exe");
});
if (seb.wholeApp) app.use((req, res, next) => {
  // SEB downloads its settings before it can send the exam hash. The profile
  // endpoint independently verifies the one-time launch's download selector.
  if (["GET", "HEAD"].includes(req.method) && /^\/api\/aula\/exam\/profile\/[a-f0-9]{64}\/Logika\.seb$/.test(req.path)) return next();
  if (seb.accepts(req)) return next();
  res.set("Cache-Control", "no-store");
  const message = "Este centro requiere el perfil autorizado de Safe Exam Browser para entrar a Logika.";
  return req.path.startsWith("/api/")
    ? res.status(403).json({ error: message })
    : res.status(403).type("text").send(message);
});
app.use(express.json());
app.use("/api/aula", classroom(process.env.LOGIKA_DATA_DIR || path.join(directory, "data"), seb));
registerRunner(app);

app.post("/api/chat", (req, res) =>
  respondWithTutor(res, req.body?.context, req.body?.messages),
);

app.post("/api/run", async (req, res) => {
  try {
    if (!process.env.RAPIDAPI_KEY)
      return res
        .status(503)
        .json({
          error:
            "El ejecutor todavía no está conectado. Configura RAPIDAPI_KEY en el archivo .env con una clave de RapidAPI que tenga acceso a Judge0 CE y reinicia el servidor. La clave de Claude solo habilita el tutor.",
        });
    const executionSignal = AbortSignal.timeout(40000);
    const { code, language_id, stdin = "" } = req.body;
    if (
      typeof code !== "string" ||
      typeof stdin !== "string" ||
      ![54, 71, 62, 63].includes(language_id)
    )
      return res
        .status(400)
        .json({ error: "Revisa el código, lenguaje y datos de entrada." });
    const response = await fetch(
      "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true",
      {
        method: "POST",
        signal: executionSignal,
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
          "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
        },
        body: JSON.stringify({
          source_code: code,
          language_id: language_id,
          stdin,
        }),
      },
    );
    let data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    for (
      let attempt = 0;
      data.token && (!data.status || data.status.id <= 2) && attempt < 12;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await fetch(
        "https://judge0-ce.p.rapidapi.com/submissions/" +
          encodeURIComponent(data.token) +
          "?base64_encoded=false",
        {
          headers: {
            "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
          },
          signal: executionSignal,
        },
      );
      data = await result.json();
      if (!result.ok) return res.status(result.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error(err.name);
    res.status(500).json({
      error: "No se pudo contactar al servicio externo. Intenta nuevamente.",
    });
  }
});

app.get("/aula", (req, res) => {
  res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
  res.set("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.sendFile(path.join(directory, "aula.html"));
});
for (const file of ["index.html", "style.css", "app.js", "terminal-stream.js", "aula.js", "aula.css"]) {
  app.get(
    file === "index.html" ? ["/", "/index.html"] : "/" + file,
    (req, res) => res.sendFile(path.join(directory, file)),
  );
}

const port = process.env.PORT || 3000;
const server = app.listen(port, process.env.LOGIKA_BIND_HOST, () => {
  console.log(`Servidor iniciado en http://localhost:${server.address().port}`);
});
