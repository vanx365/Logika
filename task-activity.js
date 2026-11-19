// Tutor replies and terminal events are recorded by their respective server handlers.
export function taskActivity(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tutor_turns (
      id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES tasks, student INTEGER NOT NULL REFERENCES users,
      at INTEGER NOT NULL, content TEXT NOT NULL, label TEXT NOT NULL, reply TEXT NOT NULL, plan TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tutor_turns_by_work ON tutor_turns(task,student,id);
    CREATE TABLE IF NOT EXISTS execution_attempts (
      id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES tasks, student INTEGER NOT NULL REFERENCES users,
      startedAt INTEGER NOT NULL, finishedAt INTEGER, code TEXT NOT NULL, inputs TEXT NOT NULL DEFAULT '',
      stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '', exitCode INTEGER, message TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS execution_attempts_by_work ON execution_attempts(task,student,id);
    CREATE TABLE IF NOT EXISTS submission_activity (
      task INTEGER NOT NULL, student INTEGER NOT NULL, lastTurn INTEGER NOT NULL, PRIMARY KEY(task,student),
      FOREIGN KEY(task,student) REFERENCES work(task,student));
  `);
  const turns = db.prepare(`SELECT at,content,label,reply FROM tutor_turns
    WHERE task=? AND student=? AND id<=? ORDER BY id DESC LIMIT ?`);
  const approvedPlan = db.prepare(`SELECT plan FROM tutor_turns
    WHERE task=? AND student=? AND id<=? AND plan<>'' ORDER BY id DESC LIMIT 1`);
  function tutorHistory(task, student, lastTurn = Number.MAX_SAFE_INTEGER, limit = 12) {
    return {
      plan: approvedPlan.get(task, student, lastTurn)?.plan || "",
      turns: turns.all(task, student, lastTurn, limit).reverse(),
    };
  }
  const insertTurn = db.prepare("INSERT INTO tutor_turns(task,student,at,content,label,reply,plan) VALUES(?,?,?,?,?,?,?)");
  function saveTurn(task, student, content, kind, evaluation) {
    const label = kind === "execution" ? "Revisa el resultado de mi ejecución." : kind === "code" ? "Revisa mi código." : content;
    const reply = evaluation.reply.replace(/^SPEC_APROBADA:\s*/, "") || evaluation.reply;
    insertTurn.run(task, student, Date.now(), content, label, reply, evaluation.approved ? evaluation.plan : "");
  }

  const snapshot = db.prepare(`INSERT INTO submission_activity(task,student,lastTurn)
    SELECT ?,?,COALESCE(MAX(id),0) FROM tutor_turns WHERE task=? AND student=?`);
  const submitted = db.prepare("SELECT lastTurn FROM submission_activity WHERE task=? AND student=?");
  const attempts = db.prepare(`SELECT startedAt,finishedAt,code,inputs,stdout,stderr,exitCode,message
    FROM execution_attempts WHERE task=? AND student=? ORDER BY id`);
  function review(task, student) {
    const cut = submitted.get(task, student);
    if (!cut) return null;
    return { ...tutorHistory(task, student, cut.lastTurn, -1), attempts: attempts.all(task, student) };
  }

  const start = db.prepare(`INSERT INTO execution_attempts(task,student,startedAt,code)
    SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM work WHERE task=? AND student=? AND submitted IS NOT NULL)`);
  // Once the solution is submitted even an already running terminal must leave its evidence unchanged.
  const writable = `WHERE id=? AND finishedAt IS NULL AND NOT EXISTS (
    SELECT 1 FROM submission_activity s WHERE s.task=execution_attempts.task AND s.student=execution_attempts.student)`;
  const append = new Map(["stdout", "stderr", "inputs"].map(column => [
    column, db.prepare(`UPDATE execution_attempts SET ${column}=${column}||? ${writable}`),
  ]));
  const finish = db.prepare(`UPDATE execution_attempts SET finishedAt=?,exitCode=?,message=? ${writable}`);
  function beginAttempt(req) {
    if (req.task.secure) return;
    const { id: task } = req.task;
    const { id: student } = req.user;
    const result = start.run(task, student, Date.now(), req.body.code, task, student);
    if (!result.changes) throw Object.assign(new Error("Tu solución ya fue entregada."), { status: 409 });
    const attempt = result.lastInsertRowid;
    let remainingInput = 131072;
    return event => {
      if (event.type === "done" || event.type === "error") {
        finish.run(Date.now(), event.exitCode ?? null, event.message || "", attempt);
      } else if (event.type === "stdout" || event.type === "stderr") {
        append.get(event.type).run(event.text, attempt);
      } else if (event.type === "input" && remainingInput >= 0) {
        const text = event.text.slice(0, remainingInput);
        const truncated = text.length < event.text.length;
        remainingInput = truncated ? -1 : remainingInput - text.length;
        append.get("inputs").run(text + (truncated ? "\n[Entrada recortada]" : ""), attempt);
      }
    };
  }
  return {
    tutorHistory, saveTurn, beginAttempt, review,
    submit(task, student) { snapshot.run(task, student, task, student); },
  };
}
