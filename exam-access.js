import { createHash, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";

const random = () => randomBytes(32).toString("hex");
const hash = value => createHash("sha256").update(value).digest("hex");
const lifetime = 180_000;

export function registerExamAccess(api, db, seb, dir, cookie) {
  const profile = path.resolve(process.env.LOGIKA_SEB_PROFILE || path.join(dir, "Logika-examen.seb"));
  const examCookie = { ...cookie, path: "/api/aula" };
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_tickets (
      ticket TEXT PRIMARY KEY, selector TEXT NOT NULL UNIQUE, source TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
      task INTEGER NOT NULL REFERENCES tasks, expires INTEGER NOT NULL, UNIQUE(source,task));
    CREATE TABLE IF NOT EXISTS exam_sessions (
      token TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
      task INTEGER NOT NULL REFERENCES tasks, UNIQUE(source,task));
  `);
  const query = sql => db.prepare(sql);
  const joined = `JOIN sessions s ON s.token=e.source JOIN users u ON s.user=u.id
    JOIN tasks t ON e.task=t.id JOIN courses c ON t.course=c.id
    JOIN members m ON m.student=u.id AND m.course=c.id`;
  const columns = "t.id AS taskId,t.due,c.id AS courseId,c.name AS courseName,u.id,u.role,u.name,e.source";
  const getSession = query("SELECT " + columns + " FROM exam_sessions e " + joined +
    " WHERE e.token=? AND s.expires>? AND u.role='student' AND t.secure=1");
  const getTicket = query("SELECT " + columns + " FROM exam_tickets e " + joined +
    " WHERE e.ticket=? AND e.expires>? AND s.expires>? AND t.due>? AND u.role='student' AND t.secure=1");
  const examInfo = row => ({ taskId: row.taskId, course: { id: row.courseId, name: row.courseName } });
  function hasProfile() {
    try { return statSync(profile).isFile(); } catch { return false; }
  }

  // The native SEB configuration downloader has no classroom cookie or exam hash yet.
  // Only the short-lived download selector goes to this endpoint. It cannot redeem the login.
  api.get("/exam/profile/:selector/Logika.seb", (req, res) => {
    const now = Date.now();
    const selector = req.params.selector;
    if (!/^[a-f0-9]{64}$/.test(selector) || !query(`SELECT 1 FROM exam_tickets e
      JOIN sessions s ON e.source=s.token WHERE selector=? AND e.expires>? AND s.expires>?`).get(hash(selector), now, now))
      return res.status(404).end();
    if (!hasProfile()) return res.status(503).end();
    res.set("Referrer-Policy", "no-referrer").type("application/seb").sendFile(profile, {
      cacheControl: false, lastModified: false, acceptRanges: false, dotfiles: "deny",
    });
  });

  // SEB intercepts this navigation. Older profiles stay on the result screen.
  api.get("/exam/finished", (_req, res) => res.status(204).end());

  api.post("/exam/redeem", (req, res) => {
    if (!seb.accepts(req)) return res.status(403).json({ error: "El perfil de SEB no está autorizado." });
    const ticket = req.body?.ticket;
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket))
      return res.status(400).json({ error: "Pase de examen inválido." });
    const digest = hash(ticket);
    const now = Date.now();
    const token = random();
    db.exec("BEGIN IMMEDIATE");
    let row;
    try {
      row = getTicket.get(digest, now, now, now);
      if (row) {
        query("DELETE FROM exam_tickets WHERE ticket=?").run(digest);
        query("INSERT OR REPLACE INTO exam_sessions(token,source,task) VALUES(?,?,?)").run(hash(token), row.source, row.taskId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (!row) return res.status(410).json({ error: "El pase venció o ya se utilizó. Pulsa «Empezar examen» de nuevo en el aula." });
    res.cookie("logika_exam", token, examCookie).json(examInfo(row));
  });

  api.use((req, res, next) => {
    const token = /(?:^|;\s*)logika_exam=([a-f0-9]{64})(?:;|$)/.exec(req.get("cookie") || "")?.[1];
    if (!token) return next();
    const tokenHash = hash(token);
    const row = getSession.get(tokenHash, Date.now());
    if (!row) { res.clearCookie("logika_exam", examCookie); return next(); }
    if (!seb.accepts(req)) return res.status(403).json({ error: "La sesión de examen requiere el perfil autorizado." });
    req.user = { id: row.id, role: row.role, name: row.name };
    req.exam = examInfo(row);
    if (req.method === "POST" && req.path === "/logout") {
      query("DELETE FROM exam_sessions WHERE token=?").run(tokenHash);
      return res.clearCookie("logika_exam", examCookie).json({ ok: true });
    }
    if ((req.method === "GET" && req.path === "/me") || req.path === "/tasks/" + row.taskId ||
        req.path.startsWith("/tasks/" + row.taskId + "/terminal") || req.path === "/tasks/" + row.taskId + "/work")
      return next();
    return res.status(403).json({ error: "La sesión permite trabajar únicamente en el examen seleccionado." });
  });

  api.post("/tasks/:task/launch", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Inicia sesión en el aula." });
    if (req.user.role !== "student") return res.status(403).json({ error: "Esta opción es para alumnos." });
    const task = query(`SELECT t.* FROM tasks t JOIN members m ON t.course=m.course
      WHERE t.id=? AND m.student=? AND t.secure=1`).get(req.params.task, req.user.id);
    if (!task) return res.status(404).json({ error: "Examen no disponible." });
    const now = Date.now();
    if (task.due <= now || query("SELECT 1 FROM work WHERE task=? AND student=? AND submitted IS NOT NULL").get(task.id, req.user.id))
      return res.status(409).json({ error: "El examen ya se cerró o fue entregado." });
    if (!seb.ready || !hasProfile()) return res.status(503).json({ error: "El administrador debe configurar el perfil final de SEB y su Browser Exam Key." });
    const ticket = random();
    const selector = random();
    query("DELETE FROM exam_tickets WHERE expires<=?").run(now);
    query("INSERT OR REPLACE INTO exam_tickets VALUES(?,?,?,?,?)")
      .run(hash(ticket), hash(selector), req.sessionHash, task.id, Math.min(task.due, now + lifetime));
    const url = seb.origin.replace(/^http/, "seb") + "/api/aula/exam/profile/" + selector + "/Logika.seb??ticket=" + ticket;
    res.json({ url });
  });
  return () => seb.ready && hasProfile();
}
