export type TxType = "income" | "expense";
export type Tx = {
  id: string;
  type: TxType;
  name: string;
  amount: number;
  category: string;
  date: string;
  hiddenFromRecent?: boolean;
};

export const CURRENCIES = {
  USD: "US Dollar ($)",
  LKR: "Sri Lankan Rupee (Rs.)",
  EUR: "Euro (€)",
  GBP: "British Pound (£)",
  INR: "Indian Rupee (₹)",
} as const;
export type Currency = keyof typeof CURRENCIES;

export const EXPENSE_CATS = ["Food", "Transport", "Shopping", "Bills", "Health", "Fun", "Other"];
export const INCOME_CATS = ["Allowance", "Salary", "Gifts", "Business", "Other"];
export const catsFor = (t: TxType | "all") =>
  t === "income"
    ? INCOME_CATS
    : t === "expense"
      ? EXPENSE_CATS
      : Array.from(new Set([...EXPENSE_CATS, ...INCOME_CATS]));

export const ICONS: Record<string, string> = {
  Food: "🍔",
  Transport: "🚌",
  Shopping: "🛍️",
  Bills: "💡",
  Health: "💊",
  Fun: "🎉",
  Other: "📦",
  Allowance: "🪙",
  Salary: "💵",
  Gifts: "🎁",
  Business: "💼",
};

export const totalOf = (l: Tx[], t: TxType) =>
  l.reduce((s, x) => (x.type === t ? s + x.amount : s), 0);

// Single-pass O(N) totals calculation
export function totals(l: Tx[]) {
  let income = 0;
  let expense = 0;
  for (const x of l) {
    if (x.type === "income") income += x.amount;
    else expense += x.amount;
  }
  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
  };
}

export function filterTx(
  l: Tx[],
  f: { type: TxType | "all"; cat: string; from?: string; month?: string },
) {
  const s = f.from;
  const m = f.month;
  return l.filter(
    (x) =>
      (f.type === "all" || x.type === f.type) &&
      (f.cat === "All" || x.category === f.cat) &&
      (!s || x.date >= s) &&
      (!m || x.date.startsWith(m)),
  );
}

// Single-pass O(N) category breakdown (eliminates per-category .filter() N+1 loop)
export function breakdown(l: Tx[], t: TxType) {
  const byCat: Record<string, number> = {};
  let total = 0;
  for (const x of l) {
    if (x.type !== t) continue;
    byCat[x.category] = (byCat[x.category] ?? 0) + x.amount;
    total += x.amount;
  }
  return catsFor(t)
    .map((c) => ({ c, t: Math.round((byCat[c] ?? 0) * 100) / 100 }))
    .filter((r) => r.t > 0)
    .sort((a, b) => b.t - a.t)
    .map((r) => ({ ...r, pct: total ? Math.round((r.t / total) * 100) : 0 }));
}

// Single-pass O(N) daily expense aggregation for a given YYYY-MM month (eliminates 31x .filter() N+1 loop)
export function dailyExpenses(l: Tx[], month: string, days: number): number[] {
  const vals = new Array<number>(days).fill(0);
  const prefix = `${month}-`;
  for (const x of l) {
    if (x.type !== "expense" || !x.date.startsWith(prefix)) continue;
    const day = Number(x.date.slice(8, 10));
    if (day >= 1 && day <= days) {
      vals[day - 1] = Math.round((vals[day - 1]! + x.amount) * 100) / 100;
    }
  }
  return vals;
}

export const groupByDate = (l: Tx[]) =>
  Object.entries(
    l.reduce<Record<string, Tx[]>>((a, x) => {
      (a[x.date] ||= []).push(x);
      return a;
    }, {}),
  ).sort((a, b) => b[0].localeCompare(a[0]));

// Amounts display compactly at every size: 1k, 1m, 1b, 1t, and on up through the -illions.
const SCALES: [number, string][] = [
  [1e3, "k"],
  [1e6, "m"],
  [1e9, "b"],
  [1e12, "t"],
  [1e15, "qa"],
  [1e18, "qi"],
  [1e21, "sx"],
  [1e24, "sp"],
  [1e27, "oc"],
  [1e30, "no"],
  [1e33, "de"],
];

export function money(n: number, currency: string) {
  const abs = Math.abs(n);
  if (!Number.isFinite(abs)) return "—";
  if (abs < 1000) return n.toLocaleString(undefined, { style: "currency", currency });
  const sym = (0)
    .toLocaleString(undefined, { style: "currency", currency })
    .replace(/[0-9.,\s]/g, "");
  const sign = n < 0 ? "−" : "";
  // Past decillions there is no short name left, so show the power of ten.
  if (abs >= 1e36) return `${sign}${sym}${abs.toExponential(2).replace("e+", "e")}`;
  let i = 0;
  for (let j = 0; j < SCALES.length; j++) if (abs >= SCALES[j]![0]) i = j;
  let v = abs / SCALES[i]![0];
  let dec = v < 10 ? 1 : 0;
  // 999.6k would round up to "1000k" — nudge it into the next tier instead.
  if (Number(v.toFixed(dec)) >= 1000 && i + 1 < SCALES.length) {
    i++;
    v = abs / SCALES[i]![0];
    dec = v < 10 ? 1 : 0;
  }
  return `${sign}${sym}${v.toFixed(dec).replace(/\.0$/, "")}${SCALES[i]![1]}`;
}
