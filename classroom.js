import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { examMessage } from "./seb.js";
import { registerRunner } from "./runner.js";
import { registerExamAccess } from "./exam-access.js";

const derive = promisify(scrypt);
const digest = value => createHash("sha256").update(value).digest();
const lifetime = 12 * 60 * 60 * 1000;
const privacyVersion = "2026-11-18";
const languages = new Set([54, 71, 62, 63]);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function field(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "Revisa el campo «" + label + "».");
  return value.trim();
}

function teacherInvite(dir) {
  if (process.env.LOGIKA_TEACHER_INVITE) return process.env.LOGIKA_TEACHER_INVITE;
  const file = path.join(dir, "invitacion-docente.txt");
  try {
    writeFileSync(file, randomBytes(24).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readFileSync(file, "utf8").trim();
}

export function classroom(dir, seb) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const invite = teacherInvite(dir);
  const db = new DatabaseSync(path.join(dir, "aula.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS privacy_acceptances (
      user INTEGER PRIMARY KEY REFERENCES users ON DELETE CASCADE, version TEXT NOT NULL, accepted_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner INTEGER NOT NULL REFERENCES users,
      code TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS members (
      course INTEGER REFERENCES courses, student INTEGER REFERENCES users, PRIMARY KEY(course, student));
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY, course INTEGER NOT NULL REFERENCES courses, title TEXT NOT NULL,
      problem TEXT NOT NULL, language INTEGER NOT NULL, due INTEGER NOT NULL, secure INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS work (
      task INTEGER REFERENCES tasks, student INTEGER REFERENCES users, code TEXT NOT NULL,
      version INTEGER NOT NULL, submitted INTEGER, grade INTEGER, feedback TEXT, PRIMARY KEY(task, student));
  `);
  const sql = query => db.prepare(query);
  const api = express.Router();
  const cookie = { httpOnly: true, sameSite: "strict", secure: seb.secureCookie, path: "/" };
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "Se requiere un mensaje JSON." });
    const token = /(?:^|;\s*)logika_session=([a-f0-9]{64})(?:;|$)/.exec(req.get("cookie") || "")?.[1];
    if (token) {
      req.sessionHash = digest(token).toString("hex");
      req.user = sql(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user
        WHERE s.token=? AND s.expires>?`).get(req.sessionHash, Date.now());
    }
    next();
  });
  const launchReady = registerExamAccess(api, db, seb, dir, cookie);
  const loginAttempts = new Map();
  function throttle(req, res, next) {
    const now = Date.now();
    for (const [key, value] of loginAttempts) if (value.end <= now) loginAttempts.delete(key);
    // A class often shares a public IP. Limit by account and by connection.
    for (const [key, max] of [["ip:" + req.ip, 240], ["account:" + String(req.body?.email).slice(0, 254).trim().toLowerCase(), 15]]) {
      const entry = loginAttempts.get(key) || { count: 0, end: now + 60000 };
      entry.count++;
      loginAttempts.set(key, entry);
      if (entry.count > max) return res.status(429).json({ error: "Demasiados intentos. Espera un minuto." });
    }
    next();
  }

  for (const action of ["register", "login"]) {
    api.post("/" + action, throttle, async (req, res, next) => {
      try {
        const { password, role } = req.body;
        const email = field(req.body.email, 254, "correo").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length > 256)
          fail(400, "Revisa tu correo y contraseña.");
        let user = sql("SELECT * FROM users WHERE email=?").get(email);
        if (action === "register") {
          if (req.body.privacyVersion !== privacyVersion)
            fail(400, "Revisa el aviso de privacidad vigente y marca la casilla para crear tu cuenta.");
          const name = field(req.body.name, 90, "nombre");
          if (password.length < 10) fail(400, "Usa al menos 10 caracteres para la contraseña.");
          if (!["teacher", "student"].includes(role)) fail(400, "Selecciona un rol.");
          if (role === "teacher" && (!invite || !timingSafeEqual(digest(invite), digest(String(req.body.invite || "")))))
            fail(403, "La invitación docente es incorrecta.");
          const salt = randomBytes(16).toString("hex");
          const hash = (await derive(password, salt, 64)).toString("hex");
          db.exec("BEGIN IMMEDIATE");
          try {
            const result = sql("INSERT INTO users(name,email,role,salt,password) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING")
              .run(name, email, role, salt, hash);
            if (!result.changes) fail(409, "Ese correo ya tiene cuenta.");
            user = { id: result.lastInsertRowid, name, role };
            sql("INSERT INTO privacy_acceptances(user,version,accepted_at) VALUES(?,?,?)").run(user.id, privacyVersion, Date.now());
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        } else {
          const hash = await derive(password, user?.salt || "logika-missing-user", 64);
          if (!user || !timingSafeEqual(hash, Buffer.from(user.password, "hex"))) fail(401, "Correo o contraseña incorrectos.");
        }
        const token = randomBytes(32).toString("hex");
        sql("DELETE FROM sessions WHERE expires<=? OR token=?").run(Date.now(), req.sessionHash || "");
        sql("INSERT INTO sessions VALUES(?,?,?)").run(digest(token).toString("hex"), user.id, Date.now() + lifetime);
        res.cookie("logika_session", token, { ...cookie, maxAge: lifetime }).json({ name: user.name, role: user.role });
      } catch (error) { next(error); }
    });
  }

  api.get("/me", (req, res) => res.json({
    user: req.user || null, sebReady: seb.ready, wholeApp: seb.wholeApp,
    inSeb: seb.accepts(req), exam: req.exam || null, launchReady: launchReady(),
  }));
  api.use((req, res, next) => req.user ? next() : res.status(401).json({ error: "Inicia sesión para entrar al aula." }));
  api.post("/logout", (req, res) => {
    sql("DELETE FROM sessions WHERE token=?").run(req.sessionHash);
    res.clearCookie("logika_session", cookie).json({ ok: true });
  });
  function requireRole(req, role) {
    if (req.user.role !== role) fail(403, "Tu cuenta no tiene permiso.");
  }
  function courseFor(req, id) {
    const course = sql(`SELECT c.* FROM courses c WHERE id=? AND
      (owner=? OR EXISTS(SELECT 1 FROM members m WHERE m.course=c.id AND m.student=?))`)
      .get(id, req.user.id, req.user.id);
    if (!course) fail(404, "Clase no disponible.");
    return course;
  }
  api.get("/courses", (req, res) => {
    const courses = req.user.role === "teacher"
      ? sql("SELECT id,name,code FROM courses WHERE owner=? ORDER BY id DESC").all(req.user.id)
      : sql("SELECT c.id,c.name FROM courses c JOIN members m ON m.course=c.id WHERE m.student=? ORDER BY c.id DESC").all(req.user.id);
    res.json(courses);
  });
  api.post("/courses", (req, res) => {
    requireRole(req, "teacher");
    const name = field(req.body.name, 100, "nombre de clase");
    const code = randomBytes(6).toString("hex").toUpperCase();
    const { lastInsertRowid: id } = sql("INSERT INTO courses(name,owner,code) VALUES(?,?,?)").run(name, req.user.id, code);
    res.status(201).json({ id, name, code });
  });
  api.post("/join", (req, res) => {
    requireRole(req, "student");
    const course = sql("SELECT id FROM courses WHERE code=?").get(field(req.body.code, 24, "código").toUpperCase());
    if (!course) fail(404, "Revisa el código de la clase.");
    sql("INSERT OR IGNORE INTO members VALUES(?,?)").run(course.id, req.user.id);
    res.json(course);
  });
  api.get("/courses/:course/tasks", (req, res) => {
    const course = courseFor(req, req.params.course);
    res.json(sql(`SELECT t.id,t.title,t.due,t.secure,w.submitted,w.grade,w.feedback
      FROM tasks t LEFT JOIN work w ON w.task=t.id AND w.student=?
      WHERE t.course=? ORDER BY t.due,t.id`).all(req.user.id, course.id));
  });
  api.post("/courses/:course/tasks", (req, res) => {
    requireRole(req, "teacher");
    const course = courseFor(req, req.params.course);
    const title = field(req.body.title, 140, "título");
    const problem = field(req.body.problem, 12000, "enunciado");
    const { language, due, secure } = req.body;
    if (!languages.has(language) || typeof secure !== "boolean")
      fail(400, "Selecciona un lenguaje y una modalidad válidos.");
    if (!Number.isSafeInteger(due) || Math.abs(due) > 8640000000000000)
      fail(400, "Revisa la fecha y la hora de cierre.");
    if (due <= Date.now()) fail(400, "La hora de cierre ya pasó. Revisa el día y si elegiste a. m. o p. m.");
    if ((secure || seb.wholeApp) && !seb.ready) fail(503, "Configura el perfil de Safe Exam Browser antes de publicar este examen.");
    const result = sql("INSERT INTO tasks(course,title,problem,language,due,secure) VALUES(?,?,?,?,?,?)")
      .run(course.id, title, problem, language, due, Number(secure || seb.wholeApp));
    res.status(201).json({ id: result.lastInsertRowid });
  });

  api.use("/tasks/:task", (req, res, next) => {
    const task = sql("SELECT * FROM tasks WHERE id=?").get(req.params.task);
    if (!task) fail(404, "Tarea no disponible.");
    courseFor(req, task.course);
    if (req.user.role === "student" && task.secure && !seb.accepts(req)) fail(403, examMessage);
    req.task = task;
    next();
  });
  const myWork = req => sql("SELECT code,version,submitted,grade,feedback FROM work WHERE task=? AND student=?").get(req.task.id, req.user.id);
  api.get("/tasks/:task", (req, res) => res.json({ task: req.task, work: myWork(req) || null, now: Date.now() }));

  function allowWork(req) {
    requireRole(req, "student");
    if (Date.now() >= req.task.due) fail(409, "El plazo de esta tarea terminó.");
    if (myWork(req)?.submitted) fail(409, "Tu solución ya fue entregada.");
  }
  api.post("/tasks/:task/work", (req, res) => {
    allowWork(req);
    const { code, version, submit } = req.body;
    if (typeof code !== "string" || Buffer.byteLength(code) > 60000 || typeof submit !== "boolean" ||
        !Number.isSafeInteger(version) || version < 0 || (submit && !code.trim()))
      fail(400, "Revisa tu solución. El máximo es 60 000 bytes y la entrega requiere código.");
    const submitted = submit ? Date.now() : null;
    const args = [code, submitted, req.task.id, req.user.id];
    const change = version === 0
      ? sql("INSERT OR IGNORE INTO work(code,submitted,task,student,version) VALUES(?,?,?,?,1)").run(...args)
      : sql("UPDATE work SET code=?,submitted=?,version=version+1 WHERE task=? AND student=? AND version=? AND submitted IS NULL").run(...args, version);
    if (!change.changes) fail(409, "Tu borrador cambió en otra sesión. Vuelve a abrir la tarea antes de guardar.");
    res.json({ version: version + 1, submitted });
  });

  const taskRunner = express.Router();
  taskRunner.use("/terminal", (req, res, next) => {
    allowWork(req);
    req.runnerOwner = req.user.id + "/" + req.task.id;
    req.runnerDeadline = req.task.due;
    req.body.language_id = req.task.language;
    next();
  });
  registerRunner(taskRunner, "/terminal");
  api.use("/tasks/:task", taskRunner);

  api.get("/tasks/:task/submissions", (req, res) => {
    requireRole(req, "teacher");
    res.json(sql(`SELECT u.id,u.name,u.email,w.submitted,w.grade,w.feedback,
      CASE WHEN w.submitted IS NOT NULL THEN w.code END AS code
      FROM members m JOIN users u ON u.id=m.student LEFT JOIN work w ON w.student=u.id AND w.task=?
      WHERE m.course=? ORDER BY u.name,u.id`).all(req.task.id, req.task.course));
  });
  api.post("/tasks/:task/submissions/:student", (req, res) => {
    requireRole(req, "teacher");
    const { grade, feedback } = req.body;
    if (!Number.isInteger(grade) || grade < 0 || grade > 20 || typeof feedback !== "string" || feedback.length > 3000)
      fail(400, "Usa una nota entera de 0 a 20 y hasta 3000 caracteres de comentario.");
    const result = sql("UPDATE work SET grade=?,feedback=? WHERE task=? AND student=? AND submitted IS NOT NULL")
      .run(grade, feedback.trim(), req.task.id, req.params.student);
    if (!result.changes) fail(404, "La entrega todavía no está disponible.");
    res.json({ ok: true });
  });
  api.use((err, req, res, next) => {
    if (!err.status) console.error("Error del aula", err.code || err.name);
    res.status(err.status || 500).json({ error: err.status ? err.message : "No se pudo completar la operación del aula." });
  });
  return api;
}
