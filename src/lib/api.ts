import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CURRENCIES, catsFor, type Currency, type Tx } from "./finance";
import { getCollections } from "./server/db";

const CURRENCY_KEYS = Object.keys(CURRENCIES) as [Currency, ...Currency[]];

const createTxSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    type: z.enum(["income", "expense"]),
    name: z.string().trim().min(1, "Please enter a description.").max(60),
    amount: z.number().finite().positive("Please enter an amount above 0."),
    category: z.string().min(1, "Please choose a category."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please pick a date."),
  })
  .refine((data) => catsFor(data.type).includes(data.category), {
    message: "Invalid category for transaction type.",
    path: ["category"],
  });

const idSchema = z.object({
  id: z.string().min(1).max(64),
});

const dateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const settingsSchema = z.object({
  currency: z.enum(CURRENCY_KEYS),
  dark: z.boolean(),
});

export type AppData = {
  connected: boolean;
  txs: Tx[];
  settings: {
    currency: Currency;
    dark: boolean;
  };
};

// Single server roundtrip loading both transactions and settings over the pooled MongoDB connection
export const getAppData = createServerFn({ method: "GET" }).handler(async (): Promise<AppData> => {
  const { transactions, settings } = await getCollections();
  const [txDocs, settingsDoc] = await Promise.all([
    transactions
      .find({}, { projection: { _id: 0, createdAt: 0 } })
      .sort({ date: -1, createdAt: -1 })
      .toArray(),
    settings.findOne({ _id: "default" }),
  ]);

  const currency: Currency =
    settingsDoc && settingsDoc.currency in CURRENCIES ? (settingsDoc.currency as Currency) : "USD";

  return {
    connected: true,
    txs: txDocs as Tx[],
    settings: {
      currency,
      dark: Boolean(settingsDoc?.dark),
    },
  };
});

export const createTransaction = createServerFn({ method: "POST" })
  .validator((input: unknown) => createTxSchema.parse(input))
  .handler(async ({ data }): Promise<Tx> => {
    const { transactions } = await getCollections();
    const now = Date.now();
    const tx: Tx = {
      id: data.id || `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: data.type,
      name: data.name,
      amount: Math.round(data.amount * 100) / 100,
      category: data.category,
      date: data.date,
    };
    await transactions.insertOne({ ...tx, createdAt: now });
    return tx;
  });

export const hideTransactionFromRecent = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { transactions } = await getCollections();
    await transactions.updateOne({ id: data.id }, { $set: { hiddenFromRecent: true } });
    return { ok: true };
  });

// Single bulk updateMany query — avoids N+1 per-item updates
export const clearRecentTransactions = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { transactions } = await getCollections();
    await transactions.updateMany(
      { hiddenFromRecent: { $ne: true } },
      { $set: { hiddenFromRecent: true } },
    );
    return { ok: true };
  },
);

export const deleteTransaction = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { transactions } = await getCollections();
    await transactions.deleteOne({ id: data.id });
    return { ok: true };
  });

// Single bulk deleteMany query for a date — avoids N+1 per-item deletes
export const deleteTransactionsByDate = createServerFn({ method: "POST" })
  .validator((input: unknown) => dateSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { transactions } = await getCollections();
    await transactions.deleteMany({ date: data.date });
    return { ok: true };
  });

// Single bulk deleteMany query to clear all history
export const clearAllTransactions = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { transactions } = await getCollections();
    await transactions.deleteMany({});
    return { ok: true };
  },
);

export const updateSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => settingsSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { settings } = await getCollections();
    await settings.updateOne(
      { _id: "default" },
      {
        $set: {
          currency: data.currency,
          dark: data.dark,
          updatedAt: Date.now(),
        },
      },
      { upsert: true },
    );
    return { ok: true };
  });
