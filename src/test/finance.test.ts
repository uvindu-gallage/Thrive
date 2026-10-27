import { describe, expect, it } from "vitest";
import {
  breakdown,
  dailyExpenses,
  filterTx,
  groupByDate,
  money,
  totals,
  type Tx,
} from "@/lib/finance";
import { getCollections } from "@/lib/server/db";

describe("finance with live MongoDB data", () => {
  it("loads transactions directly from MongoDB and computes consistent totals and breakdowns", async () => {
    const { transactions } = await getCollections();
    const list = (await transactions
      .find({}, { projection: { _id: 0, createdAt: 0 } })
      .sort({ date: -1, createdAt: -1 })
      .toArray()) as Tx[];

    const t = totals(list);
    expect(t.net).toBe(Math.round((t.income - t.expense) * 100) / 100);

    const expBreakdown = breakdown(list, "expense");
    const expSum = expBreakdown.reduce((s, r) => s + r.t, 0);
    expect(Math.round(expSum * 100) / 100).toBe(t.expense);

    const grouped = groupByDate(list);
    const dates = grouped.map(([d]) => d);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));

    if (list.length > 0) {
      const sampleMonth = list[0]!.date.slice(0, 7);
      const inMonth = filterTx(list, { type: "all", cat: "All", month: sampleMonth });
      const daily = dailyExpenses(inMonth, sampleMonth, 31);
      expect(daily).toHaveLength(31);
    }
  });
});

describe("money display", () => {
  it("keeps small amounts exact and abbreviates larger scales", () => {
    expect(money(0, "USD")).toBe("$0.00");
    expect(money(1000, "USD")).toBe("$1k");
    expect(money(1_000_000, "USD")).toBe("$1m");
    expect(money(1_000_000_000, "USD")).toBe("$1b");
  });
});
