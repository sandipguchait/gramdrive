import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { StoreShape } from "./types.js";

const storePath = path.join(config.dataDir, "store.json");

const emptyStore: StoreShape = {
  users: {},
  loginAttempts: {},
  webSessions: {},
  folders: {},
  files: {},
  activities: {}
};

let mutationQueue: Promise<void> = Promise.resolve();

async function ensureStoreFile() {
  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2));
  }
}

function normalizeStore(input: Partial<StoreShape>): StoreShape {
  return {
    users: input.users ?? {},
    loginAttempts: input.loginAttempts ?? {},
    webSessions: input.webSessions ?? {},
    folders: input.folders ?? {},
    files: input.files ?? {},
    activities: input.activities ?? {}
  };
}

function pruneExpired(store: StoreShape) {
  const now = Date.now();

  for (const [id, attempt] of Object.entries(store.loginAttempts)) {
    if (new Date(attempt.expiresAt).getTime() <= now) {
      delete store.loginAttempts[id];
    }
  }

  for (const [token, session] of Object.entries(store.webSessions)) {
    if (new Date(session.expiresAt).getTime() <= now) {
      delete store.webSessions[token];
    }
  }
}

export async function readStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(storePath, "utf8");
  const store = normalizeStore(JSON.parse(raw) as Partial<StoreShape>);
  pruneExpired(store);
  return store;
}

export async function writeStore(store: StoreShape) {
  await fs.mkdir(config.dataDir, { recursive: true });
  pruneExpired(store);

  const tempPath = `${storePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2));
  await fs.rename(tempPath, storePath);
}

export async function mutateStore<T>(mutator: (store: StoreShape) => T | Promise<T>) {
  const runMutation = async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  };

  const nextMutation = mutationQueue.then(runMutation, runMutation);
  mutationQueue = nextMutation.then(
    () => undefined,
    () => undefined
  );

  return nextMutation;
}
