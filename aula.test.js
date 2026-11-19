import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { examPolicy } from "./seb.js";

const tutorBody = { messages: [{ role: "user", content: "¿Cómo organizo mi estrategia?" }] };
const privacyVersion = "2026-11-19";

// Simula únicamente Docker. La prueba usa el runner HTTP y sus flujos reales de entrada y salida.
function simulatedProgram() {
  process.stdin.once("data", chunk => {
    const value = chunk.toString().trim();
    console.log("Entrada: " + value);
    if (value === "-1") {
      console.error("Se esperaba un entero positivo.");
      process.exitCode = 1;
    }
    if (value === "esperar") {
      const marker = require("node:path").join(process.env.LOGIKA_DATA_DIR, "continuar");
      const timer = setInterval(() => {
        if (require("node:fs").existsSync(marker)) {
          clearInterval(timer);
          console.log("Salida posterior a la entrega");
        }
      }, 20);
      setTimeout(() => clearInterval(timer), 15000).unref();
    }
    process.stdin.destroy();
  });
}

async function fixture(t, { wholeApp = false, mockTutor = false, mockRunner = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "logika-test-"));
  const key = randomBytes(32).toString("hex");
  const origin = "https://aula.example.test";
  const invite = randomBytes(18).toString("hex");
  const tutorStub = `import assert from "node:assert/strict";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const request = JSON.parse(options.body);
      assert.equal(request.model, "claude-haiku-4-5-20251001");
      assert.match(request.system, /Eres un tutor socrático de programación/);
      assert.equal(request.tool_choice.name, "evaluar_plan");
      const { problem, language } = JSON.parse(request.system.split("\\n").at(-1));
      const last = request.messages.at(-1).content;
      if (last === "Reintentar más tarde") return Response.json({ error: "Servicio temporalmente ocupado" }, { status: 503 });
      const approved = last !== "Todavía no sé cómo empezar.";
      const input = { reply: "¿Qué harías primero en " + language + "?", approved,
        plan: approved ? (last.startsWith("Leer ") ? last : problem) : "" };
      if (last === "¿Qué pasos recuerdas?") input.reply = JSON.stringify(request.messages);
      return Response.json({ content: [{ type: "tool_use", name: "evaluar_plan", input }] });
    };`;
  const runnerStub = `import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    const spawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => {
      if (args[0] === "rm") return new EventEmitter();
      if (args[0] !== "run") return spawn(command, args, options);
      return spawn(process.execPath, ["-e", ${JSON.stringify("(" + simulatedProgram.toString() + ")()")}], options);
    };
    syncBuiltinESMExports();`;
  const preload = [];
  for (const source of [mockTutor && tutorStub, mockRunner && runnerStub]) {
    if (source) preload.push("--import", "data:text/javascript," + encodeURIComponent(source));
  }
  const child = spawn(process.execPath, [...preload, "server.js"], {
    env: { ...process.env, PORT: "0", LOGIKA_BIND_HOST: "127.0.0.1", ANTHROPIC_API_KEY: mockTutor ? "test-key" : "", RAPIDAPI_KEY: "",
      LOGIKA_DATA_DIR: dir, LOGIKA_TEACHER_INVITE: invite, LOGIKA_SEB_PROFILE: "",
      LOGIKA_PUBLIC_ORIGIN: origin, SEB_BROWSER_EXAM_KEYS: key, SEB_REQUIRE_APP: String(wholeApp) },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const closed = once(child, "close");
  t.after(async () => { child.kill(); await closed; await rm(dir, { recursive: true, force: true }); });
  let endpoint;
  let log = "";
  for await (const chunk of child.stdout) {
    log += chunk;
    endpoint = /http:\/\/localhost:\d+/.exec(log)?.[0];
    if (endpoint) break;
  }
  assert.ok(endpoint, "El servidor debe iniciar");
  async function request(route, { cookie, proof, body } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (proof) headers["X-SafeExamBrowser-RequestHash"] = createHash("sha256").update(origin + route + key).digest("hex");
    if (body) headers["Content-Type"] = "application/json";
    return fetch(endpoint + route, { method: body ? "POST" : "GET", body: JSON.stringify(body), headers });
  }
  async function api(route, cookie, body, status = 200, proof = false) {
    const res = await request("/api/aula" + route, { cookie, body, proof });
    const data = await res.json();
    assert.equal(res.status, status, JSON.stringify(data));
    return data;
  }
  async function register(name, role) {
    const body = { name, role, email: name + "@example.org", password: "long-password", invite, privacyVersion };
    const response = await request("/api/aula/register", { body, proof: wholeApp });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    return cookie.split(";")[0];
  }
  return { dir, request, api, register };
}

test("Clases, permisos, entregas, calificación y cierre según el reloj del servidor", async t => {
  const { api, register, dir } = await fixture(t);
  const applicant = { role: "student", name: "Alba", email: "alba@example.org", password: "long-password" };
  await api("/register", null, applicant, 400);
  await api("/register", null, { ...applicant, privacyVersion: "anterior" }, 400);
  await api("/register", null, { ...applicant, role: "teacher", privacyVersion }, 403);
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const other = await register("Emilio", "student");
  const otherTeacher = await register("Docente2", "teacher");
  const me = (await api("/me", student)).user;
  const audit = new DatabaseSync(path.join(dir, "aula.sqlite"), { readOnly: true });
  const acceptance = audit.prepare("SELECT version,accepted_at FROM privacy_acceptances WHERE user=?").get(me.id);
  audit.close();
  assert.equal(acceptance.version, privacyVersion);
  assert.ok(acceptance.accepted_at > 0 && acceptance.accepted_at <= Date.now());
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201);
  await api("/courses", student, { name: "Test" }, 403);
  const list = "/courses/" + course.id + "/tasks";
  await api(list, otherTeacher, undefined, 404);
  const task = { title: "Suma", problem: "Suma dos enteros", language: 71, due: Date.now() + 86400000, secure: true };
  const { id } = await api(list, teacher, task, 201);
  const detail = "/tasks/" + id;
  await api(detail, other, undefined, 404, true);
  await api("/join", student, { code: course.code });
  await api("/join", student, { code: course.code });
  const [summary] = await api(list, student);
  assert.equal(summary.problem, undefined);
  const draft = { code: "print(2)", version: 0, submit: false };
  for (const [suffix, body] of [["", undefined], ["/work", draft], ["/terminal", { code: draft.code }],
    ["/terminal/input", { id: "missing", input: "" }], ["/terminal/cancel", { id: "missing" }]]) {
    await api(detail + suffix, student, body, 403);
  }
  const studentApi = (suffix, body, status) => api(detail + suffix, student, body, status, true);
  assert.equal((await studentApi("")).task.problem, task.problem);
  await studentApi("/work", draft);
  await studentApi("/work", draft, 409);
  assert.equal((await studentApi("")).work.code, draft.code);
  const roster = detail + "/submissions";
  assert.equal((await api(roster, teacher))[0].code, null);
  await studentApi("/submissions", undefined, 403);
  await api(roster, otherTeacher, undefined, 404);
  await studentApi("/work", { ...draft, version: 1, submit: true });
  await studentApi("/work", { ...draft, version: 2 }, 409);
  assert.equal((await api(roster, teacher))[0].code, draft.code);
  assert.deepEqual(await api(roster + "/" + me.id, teacher), { evidence: null });
  await api(roster + "/" + me.id, teacher, { grade: 19, feedback: "Buen razonamiento." });
  assert.equal((await api(list, student))[0].grade, 19);
  await api("/join", other, { code: course.code });
  assert.equal((await api(detail, other, undefined, 200, true)).work, null);
  const ordinary = await api(list, teacher, { ...task, secure: false }, 201);
  const ordinaryPath = "/tasks/" + ordinary.id;
  await api(ordinaryPath + "/work", student, draft);
  const db = new DatabaseSync(path.join(dir, "aula.sqlite"));
  db.prepare("UPDATE tasks SET due=? WHERE id=?").run(Date.now() - 1, ordinary.id);
  db.close();
  await api(ordinaryPath + "/terminal", student, { code: "print(2)" }, 409);
  await api(ordinaryPath + "/work", student, { ...draft, version: 1, submit: true }, 409);
  await api("/logout", student, {});
  await api(list, student, undefined, 401);
  await api("/login", null, { email: "alba@example.org", password: "long-password" });
});

test("El modo global exige el perfil tanto en las páginas como en las API", async t => {
  const { request, api, register, dir } = await fixture(t, { wholeApp: true });
  for (const route of ["/", "/aula", "/api/aula/me", "/api/chat", "/api/terminal"]) {
    assert.equal((await request(route)).status, 403);
  }
  assert.equal((await request("/aula", { proof: true })).status, 200);
  assert.equal((await request("/api/aula/me", { proof: true })).status, 200);
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201, true);
  await api("/join", student, { code: course.code }, 200, true);
  const task = { title: "Suma", problem: "Suma dos enteros", language: 71, due: Date.now() + 3600000, secure: false };
  const { id } = await api("/courses/" + course.id + "/tasks", teacher, task, 201, true);
  const db = new DatabaseSync(path.join(dir, "aula.sqlite"));
  db.prepare("UPDATE tasks SET secure=0 WHERE id=?").run(id);
  db.close();
  await api("/tasks/" + id + "/tutor", student, tutorBody, 403, true);
  assert.throws(() => examPolicy({ SEB_REQUIRE_APP: "true" }));
  assert.throws(() => examPolicy({ SEB_BROWSER_EXAM_KEYS: "invalida" }));
});

test("El pase del aula se canjea una vez en SEB y la sesión solo abre el examen elegido", async t => {
  const { api, request, register, dir } = await fixture(t);
  const teacher = await register("Docente", "teacher");
  const student = await register("Andrea", "student");
  const outsider = await register("Carlos", "student");
  const course = await api("/courses", teacher, { name: "Lógica" }, 201);
  await api("/join", student, { code: course.code });
  const list = "/courses/" + course.id + "/tasks";
  const task = { title: "Uno", problem: "Calcula", language: 71, secure: true, due: Date.now() + 3600000 };
  const { id } = await api(list, teacher, task, 201);
  const other = await api(list, teacher, { ...task, title: "Dos" }, 201);
  const launch = "/tasks/" + id + "/launch";
  await api(launch, student, {}, 503);
  assert.equal((await api("/me", student)).launchReady, false);
  const profile = Buffer.from("fixture de perfil final");
  await writeFile(path.join(dir, "Logika-examen.seb"), profile);
  assert.equal((await api("/me", student)).launchReady, true);
  await api(launch, teacher, {}, 403);
  await api(launch, outsider, {}, 404);
  await api(launch, undefined, {}, 401);
  const link = new URL((await api(launch, student, {})).url);
  assert.equal(link.protocol, "sebs:");
  assert.match(link.search, /^\?\?ticket=[a-f0-9]{64}$/);
  const download = await request(link.pathname);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("content-type"), "application/seb");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), profile);
  const ticket = link.search.slice("??ticket=".length);
  const redeem = "/api/aula/exam/redeem";
  assert.equal((await request(redeem, { body: { ticket } })).status, 403);
  const attempts = await Promise.all([1, 2].map(() => request(redeem, { body: { ticket }, proof: true })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 410]);
  const redeemed = attempts.find(r => r.status === 200);
  const exam = { taskId: id, course: { id: course.id, name: "Lógica" } };
  assert.deepEqual(await redeemed.json(), exam);
  const cookie = redeemed.headers.get("set-cookie").split(";")[0];
  assert.match(cookie, /^logika_exam=/);
  assert.deepEqual((await api("/me", cookie, undefined, 200, true)).exam, exam);
  await api("/tasks/" + id, cookie, undefined, 403);
  await api("/tasks/" + id, cookie, undefined, 200, true);
  await api("/tasks/" + id + "/tutor", cookie, tutorBody, 403, true);
  await api("/tasks/" + other.id, cookie, undefined, 403, true);
  await api("/courses", cookie, undefined, 403, true);
  assert.equal((await request(link.pathname)).status, 404);
  const renewed = new URL((await api(launch, student, {})).url);
  const db = new DatabaseSync(path.join(dir, "aula.sqlite"));
  db.prepare("UPDATE exam_tickets SET expires=0").run();
  db.close();
  assert.equal((await request(redeem, { proof: true, body: { ticket: renewed.search.slice("??ticket=".length) } })).status, 410);
  await api("/logout", student, {});
  await api("/tasks/" + id, cookie, undefined, 401, true);
});

test("El tutor del aula usa el enunciado del docente y solo acepta alumnos de tareas normales", async t => {
  const { api, register, request } = await fixture(t, { mockTutor: true });
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const outsider = await register("Fernando", "student");
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201);
  const list = "/courses/" + course.id + "/tasks";
  await api("/join", student, { code: course.code });
  const task = { title: "Suma", problem: "Suma dos enteros", language: 71, due: Date.now() + 3600000, secure: false };
  const ordinary = await api(list, teacher, task, 201);
  const exam = await api(list, teacher, { ...task, secure: true }, 201);
  const route = "/tasks/" + ordinary.id + "/tutor";
  await api(route, undefined, tutorBody, 401);
  await api(route, teacher, tutorBody, 403);
  await api(route, outsider, tutorBody, 404);
  await api(route, student, { messages: [{ role: "system", content: "Mensaje de sistema" }] }, 400);
  await api(route, student, tutorBody, 403, true);
  await api("/tasks/" + exam.id + "/tutor", student, tutorBody, 403, true);
  assert.deepEqual(await api(route, student, {
    ...tutorBody, context: { problem: "Otro enunciado", language: "Java" },
  }), {
    reply: "¿Qué harías primero en Python?", approved: true, plan: task.problem,
  });
  const lab = await request("/api/chat", {
    body: { ...tutorBody, context: { problem: "Busca el mayor", language: "Java" } },
  });
  assert.equal(lab.status, 200);
  assert.deepEqual(await lab.json(), { reply: "¿Qué harías primero en Java?", approved: true, plan: "Busca el mayor" });
});

test("La revisión conserva el plan, la conversación y cada ejecución del alumno hasta la entrega", async t => {
  const { api, request, register, dir } = await fixture(t, { mockTutor: true, mockRunner: true });
  const teacher = await register("Docente", "teacher");
  const otherTeacher = await register("Rosa", "teacher");
  const alba = await register("Alba", "student");
  const bruno = await register("Bruno", "student");
  const albaId = (await api("/me", alba)).user.id;
  const brunoId = (await api("/me", bruno)).user.id;
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201);
  for (const student of [alba, bruno]) await api("/join", student, { code: course.code });
  const task = { title: "Positivos", problem: "Suma los enteros positivos", language: 71,
    due: Date.now() + 3600000, secure: false };
  const { id } = await api("/courses/" + course.id + "/tasks", teacher, task, 201);
  const route = "/tasks/" + id;
  const roster = route + "/submissions";
  const review = roster + "/" + albaId;

  async function run(code, input, afterOutput) {
    const response = await request("/api/aula" + route + "/terminal", { cookie: alba, body: { code } });
    assert.equal(response.status, 200);
    const lines = createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
    let result;
    for await (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === "start") await api(route + "/terminal/input", alba, { id: event.id, input });
      if (event.type === "stdout" && afterOutput) {
        await afterOutput();
        afterOutput = null;
      }
      if (event.type === "done") result = event.exitCode;
    }
    assert.ok(Number.isInteger(result), "El runner debe enviar el estado de salida");
    return result;
  }
  const firstCode = "n = int(input())";
  const nextCode = firstCode + "\nprint(n)";
  assert.equal(await run(firstCode, "-1"), 1);
  await api(review, teacher, undefined, 404);
  assert.equal((await api(roster, teacher)).find(row => row.id === albaId).code, null);

  const first = "Todavía no sé cómo empezar.";
  const plan = "Leer los datos, descartar los negativos y sumar los positivos.";
  const send = (cookie, content) => api(route + "/tutor", cookie, { messages: [{ role: "user", content }] });
  const initial = await send(alba, first);
  assert.equal(initial.approved, false);
  await api(route + "/tutor", alba, { messages: [{ role: "user", content: "Reintentar más tarde" }] }, 503);
  assert.equal((await send(alba, plan)).plan, plan);
  const brunoPlan = "Leer cada entero y acumularlo si es positivo.";
  await send(bruno, brunoPlan);
  const ownTutor = (await api(route, alba)).tutor;
  assert.equal(ownTutor.plan, plan);
  assert.deepEqual(ownTutor.turns.map(turn => turn.content), [first, plan]);
  assert.equal(await run(nextCode, "7"), 0);

  const finalCode = "print(sum(n for n in datos if n > 0))";
  const pendingCode = "print('Intento aún en ejecución')";
  assert.equal(await run(pendingCode, "esperar", async () => {
    await api(route + "/work", alba, { code: finalCode, submit: true, version: 0 });
    await writeFile(path.join(dir, "continuar"), "1");
  }), 0);
  const { evidence } = await api(review, teacher);
  assert.equal((await api(roster, teacher)).find(row => row.id === albaId).code, finalCode);
  assert.equal(evidence.plan, plan);
  assert.deepEqual(evidence.turns.map(turn => [turn.content, turn.label, turn.reply]), [
    [first, first, initial.reply], [plan, plan, "¿Qué harías primero en Python?"],
  ]);
  assert.ok(evidence.turns.every(turn => Number.isSafeInteger(turn.at)));
  assert.deepEqual(evidence.attempts.map(run => run.code), [firstCode, nextCode, pendingCode]);
  const [failed, passed, pending] = evidence.attempts;
  for (const [attempt, input, exitCode] of [[failed, "-1", 1], [passed, "7", 0]]) {
    assert.equal(attempt.inputs, input + "\n");
    assert.equal(attempt.stdout, "Entrada: " + input + "\n");
    assert.equal(attempt.exitCode, exitCode);
    assert.ok(Number.isSafeInteger(attempt.startedAt));
    assert.ok(Number.isSafeInteger(attempt.finishedAt) && attempt.finishedAt >= attempt.startedAt);
  }
  assert.equal(failed.stderr, "Se esperaba un entero positivo.\n");
  assert.equal(passed.stderr, "");
  assert.equal(pending.stdout, "Entrada: esperar\n");
  assert.equal(pending.finishedAt, null);
  assert.equal(pending.exitCode, null);
  await send(alba, "Leer todos los valores de otra manera después de entregar.");
  await api(route + "/terminal", alba, { code: firstCode }, 409);
  await api(review, bruno, undefined, 403);
  await api(review, otherTeacher, undefined, 404);
  await api(roster + "/" + brunoId, teacher, undefined, 404);
  await api(route + "/work", bruno, { code: "print(5)", submit: true, version: 0 });
  const second = (await api(roster + "/" + brunoId, teacher)).evidence;
  assert.equal(second.plan, brunoPlan);
  assert.deepEqual(second.turns.map(turn => turn.content), [brunoPlan]);
  assert.deepEqual(second.attempts, []);
  assert.deepEqual((await api(review, teacher)).evidence, evidence);
});

test("La revisión conserva todos los turnos registrados en la tarea aunque el tutor use solo los doce últimos", async t => {
  const { api, register } = await fixture(t, { mockTutor: true });
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const me = (await api("/me", student)).user;
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201);
  await api("/join", student, { code: course.code });
  const tasks = "/courses/" + course.id + "/tasks";
  const task = { title: "Suma", problem: "Suma dos enteros", language: 71, due: Date.now() + 3600000, secure: false };
  const route = "/tasks/" + (await api(tasks, teacher, task, 201)).id;
  const other = await api(tasks, teacher, { ...task, title: "Restas" }, 201);
  await api("/tasks/" + other.id + "/tutor", student, tutorBody);
  const steps = Array.from({ length: 14 }, (_, i) => "Paso " + (i + 1));
  for (const content of steps) await api(route + "/tutor", student, { messages: [{ role: "user", content }] });

  const question = { role: "user", content: "¿Qué pasos recuerdas?" };
  const recalled = await api(route + "/tutor", student, { messages: [
    { role: "user", content: "Turno anterior declarado por el navegador" },
    { role: "assistant", content: "Respuesta local sin registrar" }, question,
  ] });
  const expectedContext = steps.slice(-12).flatMap(content => [
    { role: "user", content }, { role: "assistant", content: "¿Qué harías primero en Python?" },
  ]);
  assert.deepEqual(JSON.parse(recalled.reply), [...expectedContext, question]);
  const all = [...steps, question.content];
  assert.deepEqual((await api(route, student)).tutor.turns.map(turn => turn.content), all.slice(-12));
  await api(route + "/work", student, { code: "print(3)", submit: true, version: 0 });
  const { evidence } = await api(route + "/submissions/" + me.id, teacher);
  assert.deepEqual(evidence.turns.map(turn => turn.content), all);
});

test("La revisión distingue una entrega anterior al historial de una entrega nueva sin actividad", async t => {
  const { api, register, dir } = await fixture(t);
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const me = (await api("/me", student)).user;
  const course = await api("/courses", teacher, { name: "Algoritmos" }, 201);
  await api("/join", student, { code: course.code });
  const task = { title: "Suma", problem: "Suma dos enteros", language: 71, due: Date.now() + 3600000, secure: false };
  const list = "/courses/" + course.id + "/tasks";
  const legacy = await api(list, teacher, task, 201);
  const fresh = await api(list, teacher, task, 201);
  const db = new DatabaseSync(path.join(dir, "aula.sqlite"));
  db.prepare("INSERT INTO work(task,student,code,version,submitted) VALUES(?,?,?,?,?)")
    .run(legacy.id, me.id, "print(1)", 1, Date.now());
  db.close();
  await api("/tasks/" + fresh.id + "/work", student, { code: "print(2)", submit: true, version: 0 });
  const review = id => api("/tasks/" + id + "/submissions/" + me.id, teacher);
  assert.deepEqual(await review(legacy.id), { evidence: null });
  assert.deepEqual(await review(fresh.id), { evidence: { plan: "", turns: [], attempts: [] } });
});
