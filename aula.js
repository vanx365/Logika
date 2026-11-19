"use strict";
const $ = id => document.getElementById(id);
const langs = { 54: "C++", 71: "Python", 62: "Java", 63: "JavaScript" };
const formatTime = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" });
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let user, settings, course, task, work, runner;
let registering = false, busy = false, dirty = false, clockOffset = 0;
let leavingExam = false;
const isTeacher = () => user?.role === "teacher";
const taskPath = () => "/tasks/" + task.id;
const expired = () => Date.now() + clockOffset >= task.due;
const closing = due => formatTime.format(due) + " (" + zone + ")";
$("timezone").textContent = "Hora de " + zone;

function notice(text = "", error = false) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
  $("notice").classList.toggle("error", error);
}
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function action(fn) {
  return async event => {
    event?.preventDefault();
    if (busy) return;
    busy = true;
    notice();
    try { await fn(event); } catch (error) { notice(error.message, true); }
    finally { busy = false; }
  };
}
async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  };
  const response = await fetch("/api/aula" + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
  return data;
}
function screen(id) {
  clearLaunch();
  for (const section of ["access", "dashboard", "detail"]) $(section).hidden = section !== id;
  window.scrollTo(0, 0);
}
let launchTimeout;
function clearLaunch() {
  clearTimeout(launchTimeout);
  $("launch-help").hidden = true;
  $("retry-launch").removeAttribute("href");
}
async function launchExam(id) {
  clearLaunch();
  const { url } = await api("/tasks/" + id + "/launch", {});
  if (!/^sebs?:\/\//i.test(url)) throw new Error("El servidor no devolvió un enlace de examen válido.");
  $("retry-launch").href = url;
  $("launch-help").hidden = false;
  launchTimeout = setTimeout(clearLaunch, 60000);
  location.assign(url);
}
function accountFields() {
  const fields = $("account").elements;
  const teacher = registering && fields.role.value === "teacher";
  $("name-field").hidden = $("role-field").hidden = !registering;
  $("invite-field").hidden = !teacher;
  $("privacy-field").hidden = !registering;
  fields.privacyVersion.disabled = !registering;
  fields.privacyVersion.required = registering;
  if (!registering) fields.privacyVersion.checked = false;
  fields.name.required = registering;
  fields.invite.required = teacher;
  fields.password.autocomplete = registering ? "new-password" : "current-password";
  fields.password.minLength = registering ? 10 : 1;
  $("access-title").textContent = registering ? "Crear una cuenta" : "Entrar al aula";
  $("account-action").textContent = registering ? "Crear cuenta" : "Entrar";
  $("toggle-account").textContent = registering ? "Ya tengo una cuenta" : "Crear una cuenta";
}
$("toggle-account").onclick = () => { registering = !registering; notice(); accountFields(); };
$("account").elements.role.onchange = accountFields;
$("account").onsubmit = action(async () => {
  await api(registering ? "/register" : "/login", Object.fromEntries(new FormData($("account"))));
  $("account").reset();
  await start();
});
function canLeave() {
  return !dirty || confirm("¿Salir y descartar los cambios que aún no guardaste?");
}
$("logout").onclick = action(async () => {
  if (!canLeave()) return;
  await api("/logout", {});
  dirty = false;
  runner?.controller.abort();
  location.replace("/aula");
});
window.addEventListener("beforeunload", event => {
  if (dirty && !leavingExam) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });

async function start() {
  const query = new URLSearchParams(location.search);
  if (query.has("ticket")) {
    const ticket = query.get("ticket");
    history.replaceState(null, "", "/aula");
    await api("/exam/redeem", { ticket });
  }
  settings = await api("/me");
  user = settings.user;
  $("lab").hidden = settings.wholeApp || settings.inSeb;
  $("logout").hidden = !user;
  if (!user) { accountFields(); screen("access"); return; }
  $("identity").textContent = user.name + " · " + (isTeacher() ? "Profesor" : "Alumno");
  if (settings.exam) {
    course = settings.exam.course;
    $("back").hidden = true;
    $("logout").hidden = true;
    await openTask(settings.exam.taskId);
    return;
  }
  $("course-label").textContent = isTeacher() ? "Nombre de la nueva clase" : "Código de la clase";
  $("course-action").textContent = isTeacher() ? "Crear clase" : "Unirme a la clase";
  $("course-form").elements.value.maxLength = isTeacher() ? 100 : 24;
  const secure = $("publish").elements.secure;
  secure.checked = settings.sebReady;
  secure.disabled = !settings.sebReady || settings.wholeApp;
  $("seb-info").textContent = !settings.sebReady
    ? "El administrador puede habilitar los exámenes configurando Safe Exam Browser en el servidor."
    : !settings.launchReady && !settings.wholeApp
      ? "Para habilitar «Empezar examen», el administrador debe registrar el archivo final del centro en LOGIKA_SEB_PROFILE."
      : "";
  await listCourses();
}
async function listCourses(selected) {
  const list = await api("/courses");
  $("courses").replaceChildren();
  for (const item of list) {
    const button = element("button", item.name);
    button.dataset.id = item.id;
    button.onclick = action(() => selectCourse(item));
    $("courses").append(button);
  }
  await selectCourse(list.find(c => c.id === selected) || list[0]);
}
$("course-form").onsubmit = action(async () => {
  const field = $("course-form").elements.value;
  const result = isTeacher() ? await api("/courses", { name: field.value }) : await api("/join", { code: field.value });
  field.value = "";
  await listCourses(result.id);
});
function resultText(row) {
  return row.grade == null ? "" : "Nota " + row.grade + "/20" + (row.feedback ? " · " + row.feedback : "");
}
async function selectCourse(item) {
  const list = item ? await api("/courses/" + item.id + "/tasks") : [];
  const changed = course?.id !== item?.id;
  course = item;
  if (changed) {
    $("publish").reset();
    $("publish").elements.secure.checked = settings.sebReady;
    $("publisher").open = false;
  }
  task = work = null;
  screen("dashboard");
  $("course-title").textContent = item?.name || "Mis tareas";
  $("course-info").textContent = item?.code ? "Código para invitar alumnos · " + item.code : "";
  $("publisher").hidden = !(item && isTeacher());
  for (const button of $("courses").children) {
    if (Number(button.dataset.id) === item?.id) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("tasks").replaceChildren();
  for (const row of list) {
    const card = element("article", null, "row");
    card.append(element("h3", row.title), element("p", "Cierre · " + closing(row.due)));
    const status = row.submitted ? "Entregada" : Date.now() >= row.due ? "Cerrada" : "Abierta";
    card.append(element("p", [status, row.secure ? "Safe Exam Browser" : "", resultText(row)].filter(Boolean).join(" · ")));
    const needsLaunch = row.secure && !isTeacher() && !settings.inSeb;
    if (!needsLaunch || !row.submitted) {
      const label = needsLaunch ? "Empezar examen" : isTeacher() ? "Revisar entregas" : "Abrir tarea";
      const button = element("button", label, "secondary");
      button.onclick = action(() => needsLaunch ? launchExam(row.id) : openTask(row.id));
      card.append(button);
    }
    $("tasks").append(card);
  }
  if (!list.length) $("tasks").append(element("p", item ? "Todavía no hay ejercicios publicados." :
    isTeacher() ? "Crea tu primera clase para publicar un ejercicio." : "Introduce el código que te compartió tu profesor."));
}
const dueInput = $("publish").elements.due;
function showDeadline() {
  $("timezone").textContent = Number.isFinite(dueInput.valueAsNumber)
    ? "Cierra el " + closing(new Date(dueInput.value))
    : "Hora de " + zone;
}
dueInput.addEventListener("input", showDeadline);
$("end-today").onclick = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  dueInput.value = today.getFullYear() + "-" + month + "-" + day + "T23:59";
  showDeadline();
};
$("publish").onsubmit = action(async () => {
  const form = $("publish");
  const fields = form.elements;
  const due = new Date(fields.due.value).getTime();
  await api("/courses/" + course.id + "/tasks", {
    title: fields.title.value, problem: fields.problem.value, due,
    language: Number(fields.language.value), secure: fields.secure.checked
  });
  form.reset();
  showDeadline();
  fields.secure.checked = settings.sebReady;
  $("publisher").open = false;
  await selectCourse(course);
  notice("Tarea publicada.");
});

async function openTask(id) {
  const data = await api("/tasks/" + id);
  const roster = isTeacher() ? await api("/tasks/" + id + "/submissions") : null;
  task = data.task;
  work = data.work || { code: "", version: 0 };
  clockOffset = data.now - Date.now();
  dirty = false;
  $("task-course").textContent = course.name;
  $("task-title").textContent = task.title;
  $("task-meta").textContent = [langs[task.language], "Cierre · " + closing(task.due), task.secure ? "Safe Exam Browser" : ""].filter(Boolean).join(" · ");
  $("problem").textContent = task.problem;
  $("student-work").hidden = isTeacher();
  $("review").hidden = !isTeacher();
  if (isTeacher()) showRoster(roster);
  else {
    $("solution").value = work.code;
    $("output").textContent = "La salida de tu programa aparecerá aquí.";
    syncWork();
  }
  screen("detail");
}
$("back").onclick = action(async () => {
  if (!canLeave()) return;
  runner?.controller.abort();
  await selectCourse(course);
  dirty = false;
});
function syncWork() {
  if (!task || isTeacher()) return;
  const locked = Boolean(work.submitted) || expired();
  $("solution").readOnly = locked;
  $("save").disabled = $("submit-work").disabled = locked || Boolean(runner);
  $("run").disabled = locked || Boolean(runner);
  $("stop").hidden = !runner;
  $("input-form").hidden = !runner?.id || locked;
  const status = work.submitted ? "Entregada el " + closing(work.submitted) : expired() ? "Plazo cerrado · Sin entrega" :
    dirty ? "Cambios sin guardar" : work.version ? "Borrador guardado en el aula" : "Sin entregar";
  $("work-state").textContent = [status, resultText(work)].filter(Boolean).join(" · ");
  if (locked && task.secure && settings?.inSeb && !leavingExam) {
    leavingExam = true;
    runner?.controller.abort();
    window.location.assign("/api/aula/exam/finished");
  }
}
$("solution").oninput = () => { dirty = $("solution").value !== work.code; syncWork(); };
setInterval(syncWork, 1000);
async function writeWork(submit) {
  if (submit && !confirm("¿Entregar esta versión? La entrega es definitiva.")) return;
  const code = $("solution").value;
  const state = await api(taskPath() + "/work", { code, version: work.version, submit });
  Object.assign(work, state, { code });
  if (submit) $("solution").value = code;
  dirty = $("solution").value !== code;
  syncWork();
}
$("save").onclick = action(() => writeWork(false));
$("submit-work").onclick = action(() => writeWork(true));

function showRoster(list) {
  const roster = $("roster");
  roster.replaceChildren(element("p", list.filter(row => row.submitted).length + " de " + list.length + " alumnos entregaron."));
  for (const row of list) {
    const card = element("article", null, "row");
    card.append(element("h3", row.name), element("p", row.email));
    roster.append(card);
    if (!row.submitted) { card.append(element("p", "Sin entrega")); continue; }
    card.append(element("p", "Entregada el " + closing(row.submitted)));
    const details = element("details");
    details.append(element("summary", row.grade == null ? "Ver solución y calificar" : "Ver solución · Nota " + row.grade + "/20"), element("pre", row.code));
    const form = element("form");
    const grade = element("input");
    grade.type = "number"; grade.min = 0; grade.max = 20; grade.required = true; grade.value = row.grade ?? "";
    const comment = element("textarea");
    comment.maxLength = 3000; comment.value = row.feedback || "";
    for (const [text, input] of [["Nota de 0 a 20", grade], ["Comentario para el alumno", comment]]) {
      const label = element("label", text);
      label.append(input); form.append(label);
    }
    form.append(element("button", "Devolver calificación", "primary"));
    form.onsubmit = action(async () => {
      await api(taskPath() + "/submissions/" + row.id, { grade: Number(grade.value), feedback: comment.value });
      details.querySelector("summary").textContent = "Ver solución · Nota " + grade.value + "/20";
      details.open = false;
      notice("Calificación devuelta a " + row.name + ".");
    });
    details.append(form); card.append(details);
  }
}

$("run").onclick = async () => {
  if (busy || runner || expired() || work.submitted) return;
  const current = { controller: new AbortController(), path: taskPath() + "/terminal" };
  runner = current;
  syncWork();
  const output = $("output");
  output.textContent = "";
  const timeout = setTimeout(() => current.controller.abort(), 100000);
  try {
    const response = await fetch("/api/aula" + current.path, {
      method: "POST", signal: current.controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $("solution").value })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    let finished = false;
    await readTerminal(response, event => {
      if (event.type === "start") { current.id = event.id; syncWork(); }
      if (event.type === "stdout" || event.type === "stderr") output.textContent += event.text;
      if (event.type === "error" || event.type === "done") {
        finished = true;
        output.textContent += "\n" + (event.message || "Proceso terminado · Código " + event.exitCode);
      }
    });
    if (!finished) throw new Error("Se perdió la conexión con la terminal.");
  } catch (error) {
    output.textContent += "\n" + (current.controller.signal.aborted ? "Ejecución detenida." : error.message);
  } finally {
    clearTimeout(timeout);
    runner = null;
    $("input-form").reset();
    syncWork();
  }
};
$("stop").onclick = () => runner?.controller.abort();
$("input-form").onsubmit = action(async () => {
  if (!runner?.id) return;
  const input = $("input-form").elements.line;
  const value = input.value;
  await api(runner.path + "/input", { id: runner.id, input: value });
  $("output").textContent += "› " + value + "\n";
  input.value = "";
});
start().catch(error => notice(error.message, true));
