import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Home,
  Clock,
  BarChart3,
  Settings as Cog,
  Search,
  Plus,
  Minus,
  Sun,
  Moon,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  CURRENCIES,
  ICONS,
  breakdown,
  catsFor,
  dailyExpenses,
  filterTx,
  groupByDate,
  money as formatMoney,
  totals,
  type Currency,
  type Tx,
  type TxType,
} from "@/lib/finance";
import {
  clearAllTransactions,
  clearRecentTransactions,
  createTransaction,
  deleteTransaction,
  deleteTransactionsByDate,
  getAppData,
  hideTransactionFromRecent,
  updateSettings,
  type AppData,
} from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Thrive — Know your money. Grow your future." },
      {
        name: "description",
        content: "Thrive is a simple income and expense tracker for all your devices.",
      },
      { property: "og:title", content: "Thrive — Know your money. Grow your future." },
      {
        property: "og:description",
        content: "Thrive is a simple income and expense tracker for all your devices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const APP_DATA_QUERY_KEY = ["thrive-app-data"] as const;
const CAT_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)"];
const RANGES = {
  all: "All time",
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
} as const;

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const thisMonth = () => today().slice(0, 7);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y!, mo! - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDate = (d: string) =>
  new Date(d + "T00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const dayLabel = (d: string) => (d === today() ? `Today, ${fmtDate(d)}` : fmtDate(d));

type Tab = "home" | "history" | "reports" | "settings";
type DbState = "connecting" | "connected" | "error";
type MoneyFormatter = {
  money: (n: number) => string;
  signed: (x: Tx) => string;
  signedNet: (n: number) => string;
};

function createFormatter(currency: Currency): MoneyFormatter {
  const money = (n: number) => formatMoney(n, currency);
  return {
    money,
    signed: (x: Tx) => `${x.type === "income" ? "+" : "−"} ${money(x.amount)}`,
    signedNet: (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`,
  };
}

function DbStatusBadge({ state }: { state: DbState }) {
  const label =
    state === "connected"
      ? "MongoDB Connected"
      : state === "connecting"
        ? "Connecting…"
        : "DB Disconnected";
  const dotClass =
    state === "connected"
      ? "bg-income shadow-[0_0_8px_var(--income)]"
      : state === "connecting"
        ? "bg-primary animate-pulse"
        : "bg-destructive";
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground shadow-soft"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}

function Index() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("home");
  const [type, setType] = useState<TxType>("expense");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: APP_DATA_QUERY_KEY,
    queryFn: () => getAppData(),
  });

  const txs = data?.txs ?? [];
  const currency: Currency = data?.settings.currency ?? "USD";
  const dark = data?.settings.dark ?? false;
  const dbState: DbState =
    isError || Boolean(saveError)
      ? "error"
      : isLoading || !data?.connected
        ? "connecting"
        : "connected";
  const fmt = createFormatter(currency);

  useEffect(() => {
    try {
      localStorage.removeItem("expenses-v1");
      localStorage.removeItem("thrive-settings");
    } catch {
      // Ignore storage access errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const updateCache = (updater: (prev: AppData) => AppData) => {
    const prev = queryClient.getQueryData<AppData>(APP_DATA_QUERY_KEY) ?? {
      connected: true,
      txs: [],
      settings: { currency: "USD", dark: false },
    };
    queryClient.setQueryData<AppData>(APP_DATA_QUERY_KEY, updater(prev));
    return prev;
  };

  const addMutation = useMutation({
    mutationFn: (payload: Omit<Tx, "hiddenFromRecent">) => createTransaction({ data: payload }),
    onMutate: async (newTx) => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({
        ...prev,
        txs: [newTx, ...prev.txs].sort((a, b) => b.date.localeCompare(a.date)),
      }));
    },
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not save transaction to MongoDB. Please check your connection.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }),
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideTransactionFromRecent({ data: { id } }),
    onMutate: async (id) => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({
        ...prev,
        txs: prev.txs.map((x) => (x.id === id ? { ...x, hiddenFromRecent: true } : x)),
      }));
    },
    onError: (_err, _id, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not update transaction in MongoDB.");
    },
  });

  const clearRecentMutation = useMutation({
    mutationFn: () => clearRecentTransactions(),
    onMutate: async () => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({
        ...prev,
        txs: prev.txs.map((x) => ({ ...x, hiddenFromRecent: true })),
      }));
    },
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not clear recent list in MongoDB.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTransaction({ data: { id } }),
    onMutate: async (id) => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({
        ...prev,
        txs: prev.txs.filter((x) => x.id !== id),
      }));
    },
    onError: (_err, _id, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not delete transaction from MongoDB.");
    },
  });

  const deleteDayMutation = useMutation({
    mutationFn: (day: string) => deleteTransactionsByDate({ data: { date: day } }),
    onMutate: async (day) => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({
        ...prev,
        txs: prev.txs.filter((x) => x.date !== day),
      }));
    },
    onError: (_err, _day, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not delete day's transactions from MongoDB.");
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => clearAllTransactions(),
    onMutate: async () => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({ ...prev, txs: [] }));
    },
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not clear history in MongoDB.");
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (next: { currency: Currency; dark: boolean }) => updateSettings({ data: next }),
    onMutate: async (next) => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: APP_DATA_QUERY_KEY });
      return updateCache((prev) => ({ ...prev, settings: next }));
    },
    onError: (_err, _next, prev) => {
      if (prev) queryClient.setQueryData(APP_DATA_QUERY_KEY, prev);
      setSaveError("Could not save settings to MongoDB.");
    },
  });

  const recent = txs.filter((x) => !x.hiddenFromRecent);

  function startAdd(t: TxType) {
    setType(t);
    setCategory("");
    setError("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => formRef.current?.querySelector("input")?.focus(), 300);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount);
    if (!name.trim()) return setError("Please enter a description.");
    if (!Number.isFinite(value) || value <= 0) return setError("Please enter an amount above 0.");
    if (!category) return setError("Please choose a category.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Please pick a date.");
    setError("");
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    addMutation.mutate({
      id,
      type,
      name: name.trim(),
      amount: Math.round(value * 100) / 100,
      category,
      date,
    });
    setName("");
    setAmount("");
    setCategory("");
  }

  const hide = (id: string) => hideMutation.mutate(id);
  const clearRecent = () =>
    confirm("Clear Recent? History will be kept.") && clearRecentMutation.mutate();
  const del = (id: string) =>
    confirm("Delete this transaction permanently?") && deleteMutation.mutate(id);
  const delDay = (d: string) =>
    confirm("Delete all transactions from this day permanently?") && deleteDayMutation.mutate(d);
  const clearAll = () =>
    confirm("Delete ALL history permanently? This cannot be undone.") && clearAllMutation.mutate();
  const setCurrency = (nextCurrency: Currency) =>
    settingsMutation.mutate({ currency: nextCurrency, dark });
  const setDark = (nextDark: boolean) => settingsMutation.mutate({ currency, dark: nextDark });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto min-h-screen max-w-md sm:max-w-2xl md:max-w-4xl lg:grid lg:max-w-7xl lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-8 lg:py-8">
        <main className="min-w-0 overflow-x-hidden px-4 pb-32 pt-8 sm:px-6 md:px-8 lg:order-2 lg:px-0 lg:pb-12 lg:pt-0 animate-in fade-in duration-500">
          {(saveError || isError) && (
            <p className="mb-4 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">
              {saveError ||
                "Unable to load data from MongoDB. Please verify your database connection."}
            </p>
          )}
          {tab === "home" && (
            <>
              <header className="mb-5 sm:mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-4xl font-extrabold tracking-tight text-primary sm:text-5xl lg:text-4xl">
                    Thrive.
                  </h1>
                  <p className="text-sm text-muted-foreground sm:text-base lg:text-sm">
                    Know your money. Grow your future.
                  </p>
                </div>
                <DbStatusBadge state={dbState} />
              </header>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-stretch">
                <div className="flex flex-col justify-between md:col-span-6 lg:col-span-7">
                  <BalanceCard t={totals(txs)} fmt={fmt} className="mb-4 flex-1" />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => startAdd("income")}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 font-semibold text-income shadow-soft transition hover:border-income/40 hover:bg-income/5 active:scale-[0.98]"
                    >
                      <Plus size={18} /> Add Income
                    </button>
                    <button
                      type="button"
                      onClick={() => startAdd("expense")}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-card py-3.5 font-semibold text-primary shadow-soft transition hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
                    >
                      <Minus size={18} /> Add Expense
                    </button>
                  </div>
                </div>

                <div className="flex md:col-span-6 lg:col-span-5">
                  <SpendingOverview txs={txs} fmt={fmt} className="mb-0 w-full" />
                </div>

                <form
                  ref={formRef}
                  onSubmit={add}
                  className="scroll-mt-6 space-y-3 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft md:col-span-6 lg:col-span-5 h-fit"
                >
                  <h2 className="text-lg font-bold">Add Transaction</h2>
                  <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
                    {(["expense", "income"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setType(t);
                          setCategory("");
                        }}
                        className={
                          type === t
                            ? `tab ${t === "income" ? "bg-income text-income-foreground" : "bg-primary text-primary-foreground"}`
                            : "tab hover:text-foreground"
                        }
                      >
                        {t === "income" ? "Income" : "Expense"}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                    <Label text="Amount">
                      <input
                        className="field"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </Label>
                    <Label text="Category">
                      <select
                        className="field select-field"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="" disabled>
                          Choose a category
                        </option>
                        {catsFor(type).map((c) => (
                          <option key={c} value={c}>
                            {ICONS[c]} {c}
                          </option>
                        ))}
                      </select>
                    </Label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                    <Label text="Description">
                      <input
                        className="field"
                        type="text"
                        placeholder={
                          type === "income" ? "e.g. Salary, Gift…" : "e.g. Lunch, Groceries…"
                        }
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={60}
                      />
                    </Label>
                    <Label text="Date">
                      <input
                        className="field"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Label>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <button
                    type="submit"
                    className={`w-full rounded-2xl py-3.5 font-semibold transition hover:brightness-105 active:scale-[0.98] ${type === "income" ? "bg-income text-income-foreground" : "hero-card"}`}
                  >
                    {type === "income" ? "Save income" : "Save expense"}
                  </button>
                </form>

                <section className="md:col-span-6 lg:col-span-7 flex flex-col">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-bold">Recently Active</h2>
                    <div className="flex gap-3 text-sm font-medium">
                      {recent.length > 0 && (
                        <button
                          type="button"
                          onClick={clearRecent}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTab("history")}
                        className="text-primary hover:underline"
                      >
                        See all ›
                      </button>
                    </div>
                  </div>
                  {isLoading ? (
                    <Empty text="Loading your transactions…" />
                  ) : recent.length === 0 ? (
                    <Empty text="Nothing here yet. Add your first income or expense above." />
                  ) : (
                    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                      {recent.slice(0, 6).map((x) => (
                        <Row
                          key={x.id}
                          x={x}
                          fmt={fmt}
                          onRemove={() => hide(x.id)}
                          label="Remove from recent"
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "history" && (
            <History
              txs={txs}
              fmt={fmt}
              onDelete={del}
              onDeleteDay={delDay}
              onClearAll={clearAll}
            />
          )}
          {tab === "reports" && <Reports txs={txs} fmt={fmt} onDelete={del} />}
          {tab === "settings" && (
            <SettingsView
              currency={currency}
              setCurrency={setCurrency}
              dark={dark}
              setDark={setDark}
              count={txs.length}
              dbState={dbState}
            />
          )}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:sticky lg:top-8 lg:inset-auto lg:order-1 lg:z-auto lg:px-0 lg:pb-0">
          <div className="mx-auto max-w-md sm:max-w-lg md:max-w-xl lg:max-w-none rounded-3xl border border-border bg-card/95 p-2 lg:p-4 shadow-soft backdrop-blur">
            <div className="hidden lg:mb-6 lg:flex lg:items-center lg:gap-3 lg:px-2 lg:pt-1">
              <div className="hero-card flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold">
                T
              </div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold leading-tight tracking-tight text-primary">
                  Thrive.
                </p>
                <p className="truncate text-xs text-muted-foreground">Personal Finance</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1 lg:grid-cols-1 lg:gap-1.5">
              {(
                [
                  ["home", "Home", Home],
                  ["history", "History", Clock],
                  ["reports", "Reports", BarChart3],
                  ["settings", "Settings", Cog],
                ] as const
              ).map(([k, l, I]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setTab(k);
                    window.scrollTo({ top: 0 });
                  }}
                  className={`${tab === k ? "nav-btn nav-btn-active lg:bg-accent lg:text-primary" : "nav-btn"} lg:flex-row lg:justify-start lg:gap-3 lg:rounded-2xl lg:px-4 lg:py-3.5 lg:text-sm`}
                  aria-current={tab === k ? "page" : undefined}
                >
                  <I size={22} strokeWidth={tab === k ? 2.4 : 1.8} className="shrink-0" />
                  <span>{l}</span>
                </button>
              ))}
            </div>
            <div className="hidden lg:mt-6 lg:space-y-3 lg:border-t lg:border-border lg:px-2 lg:pt-4 lg:block">
              <DbStatusBadge state={dbState} />
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {currency} · {txs.length} {txs.length === 1 ? "entry" : "entries"}
                </span>
                <button
                  type="button"
                  onClick={() => setDark(!dark)}
                  aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                  className="rounded-xl border border-border p-2 text-muted-foreground transition hover:bg-accent hover:text-primary"
                >
                  {dark ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </div>
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{text}</span>
      {children}
    </label>
  );
}

function BalanceCard({
  t,
  fmt,
  title = "Total Balance",
  className = "mb-4",
}: {
  t: ReturnType<typeof totals>;
  fmt: MoneyFormatter;
  title?: string;
  className?: string;
}) {
  const [show, setShow] = useState(true);
  const mask = (s: string) => (show ? s : "••••");
  return (
    <section
      className={`hero-card relative flex flex-col justify-between overflow-hidden rounded-3xl p-5 sm:p-6 ${className}`}
    >
      <div className="hero-glow" aria-hidden />
      <div>
        <p className="text-sm opacity-90">{title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="min-w-0 break-all text-[clamp(1.5rem,6vw,2.25rem)] font-bold leading-tight tracking-tight">
            {mask(fmt.signedNet(t.net))}
          </p>
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide amounts" : "Show amounts"}
            className="shrink-0 rounded-lg p-1 opacity-80 transition hover:opacity-100"
          >
            {show ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 divide-x divide-primary-foreground/30 text-sm">
        <div className="min-w-0 pr-3">
          <p className="opacity-80">Income</p>
          <p className="break-all text-base font-semibold sm:text-lg">
            {mask(fmt.money(t.income))}
          </p>
        </div>
        <div className="min-w-0 pl-4">
          <p className="opacity-80">Spending</p>
          <p className="break-all text-base font-semibold sm:text-lg">
            {mask(fmt.money(t.expense))}
          </p>
        </div>
      </div>
    </section>
  );
}

function Donut({
  rows,
  center,
  sub,
}: {
  rows: { c: string; t: number; pct: number }[];
  center: string;
  sub: string;
}) {
  const total = rows.reduce((s, r) => s + r.t, 0);
  const R = 42,
    C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="relative h-36 w-36 sm:h-40 sm:w-40 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--secondary)" strokeWidth="11" />
        {total > 0 &&
          rows.map((r, i) => {
            const len = (r.t / total) * C;
            const el = (
              <circle
                key={r.c}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={CAT_COLORS[i % 5]}
                strokeWidth="11"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-off}
              />
            );
            off += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="max-w-[6.5rem] break-all text-xs sm:text-sm font-bold leading-tight">
          {center}
        </p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// Top 4 categories + everything else merged into "Others"
function topRows(rows: ReturnType<typeof breakdown>) {
  if (rows.length <= 5) return rows;
  const rest = rows.slice(4);
  return [
    ...rows.slice(0, 4),
    { c: "Others", t: rest.reduce((s, r) => s + r.t, 0), pct: rest.reduce((s, r) => s + r.pct, 0) },
  ];
}

function CategoryChart({ list, label, fmt }: { list: Tx[]; label: string; fmt: MoneyFormatter }) {
  const rows = topRows(breakdown(list, "expense"));
  const total = totals(list).expense;
  if (rows.length === 0)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No spending recorded for {label.toLowerCase()}.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 sm:flex-nowrap sm:justify-start sm:gap-6">
      <Donut rows={rows} center={fmt.money(total)} sub="Total Spending" />
      <ul className="min-w-[140px] flex-1 space-y-2 text-sm">
        {rows.map((r, i) => (
          <li key={r.c} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: CAT_COLORS[i % 5] }}
            />
            <span className="min-w-0 flex-1 truncate">{r.c}</span>
            <span className="font-semibold">{r.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpendingOverview({
  txs,
  fmt,
  className = "mb-6",
}: {
  txs: Tx[];
  fmt: MoneyFormatter;
  className?: string;
}) {
  const [range, setRange] = useState<"month" | "all">("month");
  const list =
    range === "month" ? filterTx(txs, { type: "all", cat: "All", month: thisMonth() }) : txs;
  return (
    <section
      className={`flex flex-col justify-between rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-bold">Spending Overview</h2>
        <select
          className="field select-field w-auto py-1.5 pl-3 text-xs"
          value={range}
          onChange={(e) => setRange(e.target.value as "month" | "all")}
          aria-label="Overview period"
        >
          <option value="month">This Month</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div className="my-auto">
        <CategoryChart
          list={list}
          label={range === "month" ? "This month" : "All time"}
          fmt={fmt}
        />
      </div>
    </section>
  );
}

function Row({
  x,
  fmt,
  onRemove,
  label,
}: {
  x: Tx;
  fmt: MoneyFormatter;
  onRemove: () => void;
  label: string;
}) {
  const inc = x.type === "income";
  return (
    <li className="flex items-center gap-3 bg-card p-4 sm:px-5 transition-colors hover:bg-accent/25 animate-in fade-in">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg ${inc ? "bg-income/15" : "bg-accent"}`}
      >
        {ICONS[x.category] ?? "📦"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{x.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {inc ? "Income" : x.category} · {inc ? x.category : "Expense"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`shrink-0 whitespace-nowrap font-semibold ${inc ? "text-income" : ""}`}>
          {fmt.signed(x)}
        </p>
        <p className="text-xs text-muted-foreground">
          {x.date === today() ? "Today" : fmtDate(x.date)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label}: ${x.name}`}
        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
      >
        ✕
      </button>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-3xl border-2 border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function TypePills({
  type,
  setType,
  className = "mb-3",
}: {
  type: TxType | "all";
  setType: (t: TxType | "all") => void;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {(
        [
          ["all", "All"],
          ["income", "Income"],
          ["expense", "Expenses"],
        ] as const
      ).map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => setType(k)}
          className={type === k ? "chip chip-active font-semibold" : "chip font-medium"}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function CatSelect({
  type,
  cat,
  setCat,
}: {
  type: TxType | "all";
  cat: string;
  setCat: (c: string) => void;
}) {
  return (
    <select
      className="field select-field text-sm"
      value={cat}
      onChange={(e) => setCat(e.target.value)}
      aria-label="Category"
    >
      <option value="All">All categories</option>
      {catsFor(type).map((c) => (
        <option key={c} value={c}>
          {ICONS[c]} {c}
        </option>
      ))}
    </select>
  );
}

function DayGroups({
  list,
  fmt,
  onDelete,
  onDeleteDay,
}: {
  list: Tx[];
  fmt: MoneyFormatter;
  onDelete: (id: string) => void;
  onDeleteDay?: (d: string) => void;
}) {
  return (
    <div className="space-y-5">
      {groupByDate(list).map(([d, items]) => {
        const t = totals(items);
        return (
          <section key={d}>
            <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <div>
                <h3 className="text-sm font-bold">{dayLabel(d)}</h3>
                <p className="text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "item" : "items"}
                  {t.income > 0 && (
                    <>
                      {" "}
                      · <span className="text-income">+{fmt.money(t.income)}</span>
                    </>
                  )}
                  {t.expense > 0 && <> · −{fmt.money(t.expense)}</>}
                </p>
              </div>
              {onDeleteDay && (
                <button
                  type="button"
                  onClick={() => onDeleteDay(d)}
                  className="text-xs font-medium text-muted-foreground hover:text-destructive"
                >
                  Delete day
                </button>
              )}
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
              {items.map((x) => (
                <Row key={x.id} x={x} fmt={fmt} onRemove={() => onDelete(x.id)} label="Delete" />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function History({
  txs,
  fmt,
  onDelete,
  onDeleteDay,
  onClearAll,
}: {
  txs: Tx[];
  fmt: MoneyFormatter;
  onDelete: (id: string) => void;
  onDeleteDay: (d: string) => void;
  onClearAll: () => void;
}) {
  const [type, setType] = useState<TxType | "all">("all");
  const [cat, setCat] = useState("All");
  const [range, setRange] = useState<keyof typeof RANGES>("all");
  const [q, setQ] = useState("");
  const setT = (t: TxType | "all") => {
    setType(t);
    if (cat !== "All" && !catsFor(t).includes(cat)) setCat("All");
  };
  const s = q.trim().toLowerCase();
  const filtered = filterTx(txs, {
    type,
    cat,
    from: range === "all" ? "" : daysAgo(Number(range) - 1),
  }).filter((x) => !s || x.name.toLowerCase().includes(s) || x.category.toLowerCase().includes(s));
  const t = totals(filtered);
  return (
    <section className="animate-in fade-in">
      <h1 className="mb-4 text-2xl font-bold sm:text-3xl">History</h1>
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="field pl-11"
            type="search"
            placeholder="Search transactions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search transactions"
          />
        </div>
        <TypePills type={type} setType={setT} className="mb-0 md:w-72" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 [&>*]:min-w-0">
        <CatSelect type={type} cat={cat} setCat={setCat} />
        <select
          className="field select-field text-sm"
          value={range}
          onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}
          aria-label="Dates"
        >
          {Object.entries(RANGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-4 rounded-3xl border border-border bg-card p-4 sm:p-5 text-center text-sm shadow-soft">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">Income</p>
          <p className="break-all font-semibold text-income sm:text-lg">+{fmt.money(t.income)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">Spending</p>
          <p className="break-all font-semibold sm:text-lg">−{fmt.money(t.expense)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">Net</p>
          <p className="break-all font-semibold text-primary sm:text-lg">{fmt.signedNet(t.net)}</p>
        </div>
      </div>
      {txs.length === 0 ? (
        <Empty text="No history yet. Income and expenses you add will appear here by date." />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={onClearAll}
              className="text-sm font-medium text-muted-foreground hover:text-destructive"
            >
              Clear history
            </button>
          </div>
          {filtered.length === 0 ? (
            <Empty text="Nothing matches. Try another search, “All”, or a wider date range." />
          ) : (
            <DayGroups list={filtered} fmt={fmt} onDelete={onDelete} onDeleteDay={onDeleteDay} />
          )}
        </>
      )}
    </section>
  );
}

function DailyBars({ list, month, fmt }: { list: Tx[]; month: string; fmt: MoneyFormatter }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  const vals = dailyExpenses(list, month, days);
  const max = Math.max(...vals, 0);
  if (max === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No spending this month yet.</p>
    );
  return (
    <div>
      <div className="flex h-36 sm:h-40 items-end gap-[2px] sm:gap-1">
        {vals.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md bg-primary transition-all"
            style={{
              height: `${Math.max((v / max) * 100, v > 0 ? 4 : 1)}%`,
              opacity: v > 0 ? 1 : 0.15,
            }}
            title={`${i + 1}: ${fmt.money(v)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>1</span>
        <span>{Math.ceil(days / 2)}</span>
        <span>{days}</span>
      </div>
    </div>
  );
}

function Reports({
  txs,
  fmt,
  onDelete,
}: {
  txs: Tx[];
  fmt: MoneyFormatter;
  onDelete: (id: string) => void;
}) {
  const [month, setMonth] = useState(thisMonth);
  const [type, setType] = useState<TxType | "all">("all");
  const [cat, setCat] = useState("All");
  const max = thisMonth();
  const inMonth = filterTx(txs, { type: "all", cat: "All", month });
  const shown = filterTx(inMonth, { type, cat });
  const label = new Date(month + "-01T00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const t = totals(inMonth);
  const incRows = breakdown(inMonth, "income");
  const setT = (x: TxType | "all") => {
    setType(x);
    if (cat !== "All" && !catsFor(x).includes(cat)) setCat("All");
  };
  return (
    <section className="animate-in fade-in">
      <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
        <div className="flex items-center gap-2 sm:w-80">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="tab border border-border bg-card px-4 hover:bg-accent"
          >
            ‹
          </button>
          <input
            type="month"
            className="field text-center font-semibold"
            value={month}
            max={max}
            onChange={(e) =>
              e.target.value && setMonth(e.target.value > max ? max : e.target.value)
            }
            aria-label="Choose month"
          />
          <button
            type="button"
            disabled={month >= max}
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Next month"
            className="tab border border-border bg-card px-4 hover:bg-accent disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <BalanceCard t={t} fmt={fmt} title={`${label} · Balance`} className="mb-0 h-full" />
        <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft">
          <div>
            <p className="text-sm font-semibold text-muted-foreground">Total Spending</p>
            <p className="mb-4 break-all text-[clamp(1.4rem,5vw,1.875rem)] font-bold">
              {fmt.money(t.expense)}
            </p>
          </div>
          <DailyBars list={inMonth} month={month} fmt={fmt} />
        </div>
        <div
          className={`rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft ${incRows.length === 0 ? "md:col-span-2" : ""}`}
        >
          <h2 className="mb-4 font-bold">Spending by Category</h2>
          <CategoryChart list={inMonth} label={label} fmt={fmt} />
        </div>
        {incRows.length > 0 && (
          <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft">
            <h2 className="mb-3 font-bold">Income by Category</h2>
            <ul className="space-y-3">
              {incRows.map(({ c, t, pct }) => (
                <li key={c}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      {ICONS[c]} {c}
                    </span>
                    <span className="font-semibold">
                      {fmt.money(t)}{" "}
                      <span className="font-normal text-muted-foreground">· {pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-income" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {inMonth.length === 0 ? (
        <Empty text={`Nothing recorded in ${label}.`} />
      ) : (
        <>
          <h2 className="mb-3 mt-6 text-lg font-bold">Transactions</h2>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_260px] md:items-center">
            <TypePills type={type} setType={setT} className="mb-0" />
            <CatSelect type={type} cat={cat} setCat={setCat} />
          </div>
          {shown.length === 0 ? (
            <Empty text="Nothing matches these filters this month." />
          ) : (
            <DayGroups list={shown} fmt={fmt} onDelete={onDelete} />
          )}
        </>
      )}
    </section>
  );
}

function SettingsView({
  currency,
  setCurrency,
  dark,
  setDark,
  count,
  dbState,
}: {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  count: number;
  dbState: DbState;
}) {
  return (
    <section className="animate-in fade-in space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
        <DbStatusBadge state={dbState} />
      </div>
      <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-soft">
        <div className="hero-card flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-bold">
          T
        </div>
        <div>
          <p className="font-bold">Thrive</p>
          <p className="text-sm text-muted-foreground">
            {count} {count === 1 ? "transaction" : "transactions"} synced with MongoDB
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft">
          <Label text="Currency display">
            <select
              className="field select-field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {Object.entries(CURRENCIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Label>
          <p className="mt-3 text-xs text-muted-foreground">
            Only changes the symbol shown. Your saved amounts are never converted.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-soft">
          <p className="mb-3 text-sm font-semibold">Appearance</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                [false, "Light Mode", Sun],
                [true, "Dark Mode", Moon],
              ] as const
            ).map(([v, l, I]) => (
              <button
                key={l}
                type="button"
                onClick={() => setDark(v)}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-semibold transition ${dark === v ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
              >
                <I size={26} />
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="px-2 text-center text-xs text-muted-foreground">
        Your transactions and settings are saved directly to MongoDB and synced across all your
        devices.
      </p>
    </section>
  );
}
