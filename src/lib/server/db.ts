import { MongoClient, type Collection, type Db } from "mongodb";
import type { TxType } from "../finance";

export interface TxDocument {
  id: string;
  type: TxType;
  name: string;
  amount: number;
  category: string;
  date: string;
  hiddenFromRecent?: boolean;
  createdAt: number;
}

export interface SettingsDocument {
  _id: string;
  currency: string;
  dark: boolean;
  updatedAt: number;
}

declare global {
  // Preserve pooled client across HMR reloads in development
  var __thriveMongoClientPromise: Promise<MongoClient> | undefined;
  var __thriveIndexesPromise: Promise<void> | undefined;
}

function getEnv(key: string, fallback?: string): string {
  if (!process.env[key] && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile();
    } catch {
      // Ignore if .env file does not exist in production environment
    }
  }
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getClientPromise(): Promise<MongoClient> {
  if (!globalThis.__thriveMongoClientPromise) {
    const uri = getEnv("MONGODB_URI");
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 8000,
    });
    globalThis.__thriveMongoClientPromise = client.connect().catch((err) => {
      globalThis.__thriveMongoClientPromise = undefined;
      throw err;
    });
  }
  return globalThis.__thriveMongoClientPromise;
}

async function ensureIndexes(db: Db): Promise<void> {
  if (!globalThis.__thriveIndexesPromise) {
    globalThis.__thriveIndexesPromise = (async () => {
      const txCol = db.collection<TxDocument>("transactions");
      await txCol.createIndexes([
        { key: { id: 1 }, unique: true, name: "idx_tx_id_unique" },
        { key: { date: -1, createdAt: -1 }, name: "idx_tx_date_created" },
        { key: { type: 1, category: 1, date: -1 }, name: "idx_tx_type_cat_date" },
        { key: { hiddenFromRecent: 1, date: -1 }, name: "idx_tx_recent_date" },
      ]);
    })().catch((err) => {
      globalThis.__thriveIndexesPromise = undefined;
      throw err;
    });
  }
  return globalThis.__thriveIndexesPromise;
}

export async function getCollections(): Promise<{
  transactions: Collection<TxDocument>;
  settings: Collection<SettingsDocument>;
}> {
  const client = await getClientPromise();
  const dbName = getEnv("MONGODB_DB", "thrive");
  const db = client.db(dbName);
  await ensureIndexes(db);
  return {
    transactions: db.collection<TxDocument>("transactions"),
    settings: db.collection<SettingsDocument>("settings"),
  };
}
