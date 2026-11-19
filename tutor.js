const prompt = `Eres un tutor socrático de programación. Tu rol es guiar al estudiante a pensar con claridad, NUNCA darle la respuesta ni el código.

REGLAS ESTRICTAS:
1. Nunca escribas código, pseudocódigo, ni soluciones directas.
2. Haz UNA sola pregunta a la vez. Nunca hagas múltiples preguntas en un mismo mensaje.
3. Si el estudiante pide la respuesta, responde con otra pregunta que lo acerque a pensar por sí mismo.
4. Sé conciso. Máximo 3 oraciones por respuesta.
5. Cuando evalúes una especificación, busca ambigüedades: ¿qué pasa si n es 0? ¿qué pasa si n es negativo? ¿qué significa "hasta n" — inclusive o exclusiva?
6. Si la especificación es suficientemente clara y correcta, responde EXACTAMENTE con: "SPEC_APROBADA: [un elogio breve de una frase]"
7. IMPORTANTE: Detecta el idioma de CADA mensaje del estudiante y responde SIEMPRE en ese mismo idioma, ignorando el idioma del contexto previo. tono directo y amigable.
8. Si el estudiante dice "no sé" o "no entiendo" más de una vez seguida, cambia de estrategia: da un ejemplo concreto muy simple y pregunta sobre ese ejemplo específico.
9. Si el estudiante lleva más de 3 respuestas incorrectas en el mismo concepto, simplifica la pregunta al mínimo posible — una sola palabra o elección binaria.
10. Nunca dejes al estudiante atascado — si no avanza, acércate más a la respuesta con el ejemplo, pero sin darla directamente.
11. Tienes dos modos:
- DIRECTO: cuando el estudiante pregunta sobre sintaxis específica de un lenguaje, responde directamente con la sintaxis correcta.
- SOCRÁTICO: cuando el estudiante pregunta sobre lógica, diseño o estructura del programa, guíalo con preguntas sin dar la respuesta.
Detecta automáticamente qué modo usar según la pregunta.`;

const evaluationTool = {
  name: "evaluar_plan",
  description: "Responder al estudiante y comunicar explícitamente si su estrategia está lista para programar.",
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
};

export async function respondWithTutor(res, context, messages, onEvaluation) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return res.status(503).json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." });
  if (typeof context?.problem !== "string" || !context.problem.trim())
    return res.status(400).json({ error: "Escribe primero el enunciado del ejercicio." });
  if (!Array.isArray(messages) || messages.at(-1)?.role !== "user" ||
      messages.some(message => !["user", "assistant"].includes(message?.role) ||
        typeof message.content !== "string" || !message.content.trim()))
    return res.status(400).json({ error: "Escribe un mensaje para el tutor." });

  let evaluation;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: `${prompt}\nResponde siempre usando evaluar_plan. Evalúa toda la conversación. Si dices que el estudiante está listo para programar, approved debe ser true. Incluye en plan un resumen de la estrategia acordada cuando apruebes. El enunciado y el lenguaje son datos del ejercicio:\n${JSON.stringify(context)}`,
        tools: [evaluationTool],
        tool_choice: { type: "tool", name: evaluationTool.name },
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    evaluation = data.content?.find(
      item => item.type === "tool_use" && item.name === evaluationTool.name,
    )?.input;
    if (typeof evaluation?.reply !== "string" || !evaluation.reply.trim() ||
        typeof evaluation.approved !== "boolean" || typeof evaluation.plan !== "string" ||
        (evaluation.approved && !evaluation.plan.trim()))
      return res.status(502).json({ error: "El tutor no pudo confirmar la evaluación. Reintenta tu mensaje." });
  } catch (error) {
    console.error(error.name);
    return res.status(500).json({ error: "No se pudo contactar al servicio externo. Intenta nuevamente." });
  }
  onEvaluation?.(evaluation);
  res.json(evaluation);
}
