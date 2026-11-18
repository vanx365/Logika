import { createHash, timingSafeEqual } from "node:crypto";

export function publicOrigin(value) {
  const origin = new URL(value);
  if (origin.href !== origin.origin + "/" || !["https:", "http:"].includes(origin.protocol))
    throw new Error("LOGIKA_PUBLIC_ORIGIN debe ser un origen HTTP(S) sin ruta.");
  if (origin.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    throw new Error("Usa HTTPS para el dominio del aula.");
  return origin;
}

export function examPolicy(env) {
  const keys = (env.SEB_BROWSER_EXAM_KEYS || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
  if (keys.some(k => !/^[a-f0-9]{64}$/.test(k))) throw new Error("Revisa SEB_BROWSER_EXAM_KEYS.");
  const origin = env.LOGIKA_PUBLIC_ORIGIN ? publicOrigin(env.LOGIKA_PUBLIC_ORIGIN) : null;
  const ready = Boolean(origin && keys.length);
  const wholeApp = env.SEB_REQUIRE_APP === "true";
  if (env.SEB_REQUIRE_APP && !["true", "false"].includes(env.SEB_REQUIRE_APP))
    throw new Error("SEB_REQUIRE_APP admite true o false.");
  if (wholeApp && !ready) throw new Error("Completa el origen y las Browser Exam Keys antes de exigir SEB.");
  function accepts(req) {
    const proof = req.get("X-SafeExamBrowser-RequestHash");
    if (!ready || !/^[a-f0-9]{64}$/i.test(proof || "")) return false;
    const url = origin.origin + req.originalUrl;
    return keys.some(key => timingSafeEqual(
      createHash("sha256").update(url + key).digest(), Buffer.from(proof, "hex")
    ));
  }
  return { ready, wholeApp, accepts, origin: origin?.origin, secureCookie: origin?.protocol === "https:" };
}

export const examMessage = "Para acceder a este contenido, abre el entorno seguro de Logika desde «Empezar examen».";
