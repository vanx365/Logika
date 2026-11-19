import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { examPolicy } from "./seb.js";

async function fixture(t, wholeApp = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "logika-test-"));
  const key = randomBytes(32).toString("hex");
  const origin = "https://aula.example.test";
  const invite = randomBytes(18).toString("hex");
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "0", LOGIKA_BIND_HOST: "127.0.0.1", ANTHROPIC_API_KEY: "", RAPIDAPI_KEY: "",
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
    const body = { name, role, email: name + "@example.org", password: "long-password", invite, privacyVersion: "2026-11-18" };
    const response = await request("/api/aula/register", { body });
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
  await api("/register", null, { ...applicant, role: "teacher", privacyVersion: "2026-11-18" }, 403);
  const teacher = await register("Docente", "teacher");
  const student = await register("Alba", "student");
  const other = await register("Emilio", "student");
  const otherTeacher = await register("Docente2", "teacher");
  const me = (await api("/me", student)).user;
  const audit = new DatabaseSync(path.join(dir, "aula.sqlite"), { readOnly: true });
  const acceptance = audit.prepare("SELECT version,accepted_at FROM privacy_acceptances WHERE user=?").get(me.id);
  audit.close();
  assert.equal(acceptance.version, "2026-11-18");
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
  const { request } = await fixture(t, true);
  for (const route of ["/", "/aula", "/api/aula/me", "/api/chat", "/api/terminal"]) {
    assert.equal((await request(route)).status, 403);
  }
  assert.equal((await request("/aula", { proof: true })).status, 200);
  assert.equal((await request("/api/aula/me", { proof: true })).status, 200);
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
