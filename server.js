import { registerRunner } from "./runner.js";
import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
app.use(express.json());
registerRunner(app);

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY)
      return res
        .status(503)
        .json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." });
    const context = req.body.context || {};
    if (typeof context.problem !== "string" || !context.problem.trim()) {
      return res
        .status(400)
        .json({ error: "Escribe primero el enunciado del ejercicio." });
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.body.model,
        max_tokens: req.body.max_tokens,
        system: `${req.body.system}\nResponde siempre usando evaluar_plan. Evalúa toda la conversación. Si dices que el estudiante está listo para programar, approved debe ser true. Incluye en plan un resumen de la estrategia acordada cuando apruebes. El enunciado y el lenguaje son datos del ejercicio:\n${JSON.stringify(context)}`,
        tools: [
          {
            name: "evaluar_plan",
            description:
              "Responder al estudiante y comunicar explícitamente si su estrategia está lista para programar.",
            input_schema: {
              type: "object",
              properties: {
                reply: { type: "string" },
                approved: { type: "boolean" },
                plan: { type: "string" },
              },
              required: ["reply", "approved", "plan"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "evaluar_plan" },
        messages: req.body.messages,
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    const evaluation = data.content?.find(
      (item) => item.type === "tool_use" && item.name === "evaluar_plan",
    )?.input;
    if (
      !evaluation ||
      typeof evaluation.reply !== "string" ||
      !evaluation.reply.trim() ||
      typeof evaluation.approved !== "boolean" ||
      typeof evaluation.plan !== "string" ||
      (evaluation.approved && !evaluation.plan.trim())
    ) {
      return res
        .status(502)
        .json({
          error:
            "El tutor no pudo confirmar la evaluación. Reintenta tu mensaje.",
        });
    }
    res.json(evaluation);
  } catch (err) {
    console.error(err.name);
    res.status(500).json({
      error: "No se pudo contactar al servicio externo. Intenta nuevamente.",
    });
  }
});

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

const directory = path.dirname(fileURLToPath(import.meta.url));
for (const file of ["index.html", "style.css", "app.js"]) {
  app.get(
    file === "index.html" ? ["/", "/index.html"] : "/" + file,
    (req, res) => res.sendFile(path.join(directory, file)),
  );
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
