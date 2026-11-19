// Preserve original scalar lexemes, duplicate keys and integer precision.
export async function formatJson(source, cancelled = () => false) {
  const token =
    /\s+|"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/y;
  const stack = [{ kind: "root", state: "value" }],
    out = [];
  let index = 0,
    total = 0,
    lastYield = 0;
  const emit = (s) => {
    total += s.length;
    if (total > 16 * 1048576) throw new Error("limit");
    out.push(s);
  };
  const newline = () => emit("\n" + "  ".repeat(stack.length - 1));
  while (index < source.length) {
    if (index - lastYield > 32768) {
      lastYield = index;
      await new Promise((resolve) => {
        if (globalThis.scheduler?.yield)
          globalThis.scheduler.yield().then(resolve);
        else setTimeout(resolve, 0);
      });
      if (cancelled()) throw new Error("cancelled");
    }
    token.lastIndex = index;
    const match = token.exec(source);
    if (!match) throw new Error("json");
    index = token.lastIndex;
    const t = match[0];
    if (/^\s/.test(t)) continue;
    const context = stack.at(-1);
    if (t === "}" || t === "]") {
      if (
        (t === "}" ? context.kind !== "object" : context.kind !== "array") ||
        !["end", "first"].includes(context.state)
      )
        throw new Error("json");
      stack.pop();
      if (context.state !== "first") newline();
      emit(t);
      continue;
    }
    if (t === ",") {
      if (context.state !== "end" || context.kind === "root")
        throw new Error("json");
      context.state = context.kind === "object" ? "key" : "value";
      emit(",");
      newline();
      continue;
    }
    if (t === ":") {
      if (context.kind !== "object" || context.state !== "colon")
        throw new Error("json");
      context.state = "value";
      emit(": ");
      continue;
    }
    if (context.kind === "object" && ["first", "key"].includes(context.state)) {
      if (!t.startsWith('"')) throw new Error("json");
      if (context.state === "first") newline();
      emit(t);
      context.state = "colon";
      continue;
    }
    if (!["first", "value"].includes(context.state)) throw new Error("json");
    if (context.kind === "array" && context.state === "first") newline();
    context.state = "end";
    emit(t);
    if (t === "{" || t === "[") {
      if (stack.length > 128) throw new Error("limit");
      stack.push({ kind: t === "{" ? "object" : "array", state: "first" });
    }
  }
  if (stack.length !== 1 || stack[0].state !== "end") throw new Error("json");
  return out.join("");
}
