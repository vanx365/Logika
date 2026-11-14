import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." });
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
        system: req.body.system,
        messages: req.body.messages,
      }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error(err.name);
    res
      .status(500)
      .json({
        error: "No se pudo contactar al servicio externo. Intenta nuevamente.",
      });
  }
});

app.post("/api/run", async (req, res) => {
  try {
    if (!process.env.RAPIDAPI_KEY)
      return res
        .status(503)
        .json({ error: "Falta configurar RAPIDAPI_KEY en el servidor." });
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
    for (let attempt = 0; data.token && (!data.status || data.status.id <= 2) && attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await fetch("https://judge0-ce.p.rapidapi.com/submissions/" + encodeURIComponent(data.token) + "?base64_encoded=false", {
        headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY, "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com" },
        signal: executionSignal
      });
      data = await result.json();
      if (!result.ok) return res.status(result.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error(err.name);
    res
      .status(500)
      .json({
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
