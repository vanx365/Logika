import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const legacyKey = "logika.exercise.v2";

// Run the browser's real initialization, button handlers and request builder with
// a shared storage object. Each invocation has its own tab globals and DOM.
function openLab(storage, navigation) {
  const nodes = new Map();
  const requests = [];
  function node() {
    const handlers = {};
    return {
      value: "", children: [], dataset: {},
      addEventListener(name, callback) { handlers[name] = callback; },
      dispatch(name) { handlers[name]?.({ preventDefault() {} }); },
      append(child) { this.children.push(child); },
      setAttribute() {}, removeAttribute() {}, focus() {},
    };
  }
  function field(id) {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  }
  field("language").value = "C++";
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  vm.runInNewContext(app, {
    document: { getElementById: field, createElement: node },
    window: { history: navigation },
    location: { reload() { navigation.reloaded = true; } },
    confirm: () => true, localStorage, AbortSignal, crypto,
    async fetch(url, options) {
      assert.equal(url, "/api/chat");
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ reply: "Continúa", approved: false }) };
    },
  });
  return { field, requests };
}

for (const readonly of [false, true]) {
  test("Nuevo ejercicio aísla el historial con almacenamiento " + (readonly ? "de solo lectura" : "compartido entre pestañas"), async () => {
    const first = {
      problem: "PROBLEMA ANTERIOR", language: "Python", approved: true, reviewed: true,
      plan: "PLAN ANTERIOR", code: "CODIGO ANTERIOR",
      history: [{ role: "user", content: "PREGUNTA ANTERIOR" }, { role: "assistant", content: "RESPUESTA ANTERIOR" }],
      messages: [{ role: "ai", text: "RESPUESTA ANTERIOR" }],
    };
    const storage = new Map([[legacyKey, JSON.stringify(first)]]);
    if (readonly) storage.set = storage.delete = () => { throw new Error("Storage unavailable"); };
    const navigation = { state: null, replaceState(state) { this.state = state; } };
    const current = openLab(storage, navigation);
    const stale = openLab(storage, { state: null });
    assert.equal(current.field("problem").value, first.problem);
    current.field("reset-button").dispatch("click");
    assert.ok(navigation.reloaded);
    const fresh = openLab(storage, navigation);
    assert.equal(fresh.field("problem").value, "");
    assert.equal(fresh.field("messages").children.length, 1);
    assert.doesNotMatch(fresh.field("messages").children[0].textContent, /ANTERIOR/);
    fresh.field("problem").value = "SEGUNDO";
    fresh.field("chat-input").value = "Mi nueva idea";
    fresh.field("chat-form").dispatch("submit");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fresh.requests[0].messages, [{ role: "user", content: "Mi nueva idea" }]);
    assert.equal(fresh.requests[0].context.problem, "SEGUNDO");
    assert.doesNotMatch(JSON.stringify(fresh.requests[0]), /ANTERIOR/);

    stale.field("code").dispatch("input");
    const reloaded = openLab(storage, navigation);
    assert.equal(reloaded.field("problem").value, readonly ? "" : "SEGUNDO");
    assert.doesNotMatch(JSON.stringify(reloaded.field("messages").children), /ANTERIOR/);
  });
}
