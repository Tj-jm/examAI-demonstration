// The calculator's arithmetic: a small parser, never eval, so whatever is
// typed can only ever be a number or an error.
//
//   expr    := term (("+" | "-") term)*
//   term    := unary (("×" | "÷") unary | unary)*      (the bare case is 2π, 3(4))
//   unary   := ("-" | "+") unary | power
//   power   := postfix ("^" unary)?                    (right to left: 2^3^2 = 2^9)
//   postfix := primary ("!" | "%")*
//   primary := number | π | e | ANS | fn "(" expr ")" | "(" expr ")" | "√" primary
//
// Brackets left open at the end are closed, as on a handheld calculator.

const FUNCS = ["asin", "acos", "atan", "sin", "cos", "tan", "log", "ln", "sqrt", "cbrt"];

export const tokenize = (src) => {
  const s = String(src).replace(/\s+/g, "").replace(/\*/g, "×").replace(/\//g, "÷").replace(/−/g, "-");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const num = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/.exec(rest);
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const fn = FUNCS.find((f) => rest.startsWith(f));
    if (fn) { out.push({ t: "fn", v: fn }); i += fn.length; continue; }
    if (rest.startsWith("ANS")) { out.push({ t: "ans" }); i += 3; continue; }
    const c = s[i];
    if (c === "π") out.push({ t: "num", v: Math.PI });
    else if (c === "e") out.push({ t: "num", v: Math.E });
    else if ("+-×÷^()!%√".includes(c)) out.push({ t: c });
    else throw new Error(`Unknown "${c}"`);
    i += 1;
  }
  return out;
};

const factorial = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error("n! needs a whole number from 0 to 170");
  let r = 1;
  for (let k = 2; k <= n; k += 1) r *= k;
  return r;
};

export const evaluate = (src, { deg = true, ans = 0 } = {}) => {
  const tokens = tokenize(src);
  if (!tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (t) => (peek()?.t === t ? tokens[pos++] : null);
  const toRad = (x) => (deg ? (x * Math.PI) / 180 : x);
  const fromRad = (x) => (deg ? (x * 180) / Math.PI : x);
  const startsPrimary = (tok) => tok && ["num", "fn", "ans", "(", "√"].includes(tok.t);

  const call = (fn, x) => {
    switch (fn) {
      case "sin": return Math.sin(toRad(x));
      case "cos": return Math.cos(toRad(x));
      case "tan": {
        if (Math.abs(Math.cos(toRad(x))) < 1e-12) throw new Error("tan is undefined here");
        return Math.tan(toRad(x));
      }
      case "asin": case "acos": {
        if (x < -1 || x > 1) throw new Error(`${fn} needs a value from -1 to 1`);
        return fromRad(fn === "asin" ? Math.asin(x) : Math.acos(x));
      }
      case "atan": return fromRad(Math.atan(x));
      case "log": case "ln": {
        if (x <= 0) throw new Error(`${fn} needs a value above 0`);
        return fn === "log" ? Math.log10(x) : Math.log(x);
      }
      case "sqrt": {
        if (x < 0) throw new Error("√ needs a value of 0 or more");
        return Math.sqrt(x);
      }
      case "cbrt": return Math.cbrt(x);
      default: throw new Error("Unknown function");
    }
  };

  let expr;
  const group = () => {
    const v = expr();
    if (!take(")") && pos < tokens.length) throw new Error("Missing )");
    return v;
  };
  const primary = () => {
    const tok = peek();
    if (!tok) throw new Error("Incomplete");
    if (tok.t === "num") { pos += 1; return tok.v; }
    if (tok.t === "ans") { pos += 1; return ans; }
    if (tok.t === "(") { pos += 1; return group(); }
    if (tok.t === "√") { pos += 1; return call("sqrt", take("-") ? -postfix() : postfix()); }
    if (tok.t === "fn") {
      pos += 1;
      if (!take("(")) throw new Error(`${tok.v} needs (`);
      return call(tok.v, group());
    }
    throw new Error("Incomplete");
  };
  const postfix = () => {
    let v = primary();
    for (;;) {
      if (take("!")) v = factorial(v);
      else if (take("%")) v /= 100;
      else return v;
    }
  };
  const unary = () => {
    if (take("-")) return -unary();
    if (take("+")) return unary();
    const base = postfix();
    if (take("^")) {
      const v = base ** unary();
      if (Number.isNaN(v)) throw new Error("Not a real number");
      return v;
    }
    return base;
  };
  const term = () => {
    let v = unary();
    for (;;) {
      if (take("×")) v *= unary();
      else if (take("÷")) {
        const d = unary();
        if (d === 0) throw new Error("Can't divide by 0");
        v /= d;
      } else if (startsPrimary(peek())) v *= unary();
      else return v;
    }
  };
  expr = () => {
    let v = term();
    for (;;) {
      if (take("+")) v += term();
      else if (take("-")) v -= term();
      else return v;
    }
  };

  const value = expr();
  while (take(")"));
  if (pos < tokens.length) throw new Error("Check the expression");
  if (!Number.isFinite(value)) throw new Error("Too large");
  // 12 significant figures: sin(180°) is 0, not 1.2e-16.
  const clean = Number(value.toPrecision(12));
  return Object.is(clean, -0) ? 0 : clean;
};

// For the display: plain up to 10 digits, else scientific.
export const format = (n) => {
  if (n === null || n === undefined) return "";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e10 || abs < 1e-6)) return n.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "E").replace("e", "E");
  return String(Number(n.toPrecision(10)));
};
