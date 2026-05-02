import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { config, hasTelegramConfig } from "./config.js";
import { decryptText, encryptText } from "./crypto.js";
import { mutateStore, readStore } from "./store.js";
import {
  findGramDriveFiles,
  listCreatedChannels,
  requestLoginCode,
  signInWithCode,
  signInWithPassword,
  toTelegramError,
  withUserClient
} from "./telegram.js";
import type {
  ActivityRecord,
  DriveFileRecord,
  FolderRecord,
  LoginAttempt,
  PublicUser,
  StoreShape,
  TelegramCredentials,
  UserAccount
} from "./types.js";

export const app = express();
const sessionCookie = "tdrive_session";
const loginAttemptCookie = "tdrive_login_attempt";
const maxCookieChunkLength = 2800;
const maxCookieChunks = 12;
const oneDayMs = 24 * 60 * 60 * 1000;
const sessionDurationMs = 30 * oneDayMs;
const loginDurationMs = 10 * 60 * 1000;
const rootFolderId = "root";
const telegramImportCooldownMs = 5 * 60 * 1000;
const lastTelegramImportByUser = new Map<string, number>();
const appBuild = "channels-v1-20260502";

type StatelessSessionPayload = {
  version: 1;
  user: PublicUser & {
    telegramUserId: string;
  };
  apiId?: number;
  apiHash?: string;
  session: string;
  createdAt: string;
  expiresAt: string;
};

await fs.mkdir(path.join(config.dataDir, "tmp"), { recursive: true });

const upload = multer({
  dest: path.join(config.dataDir, "tmp"),
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024
  }
});

app.use(express.json({ limit: "1mb" }));

function jsonError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function parseCookies(req: Request) {
  const header = req.headers.cookie;
  const cookies = new Map<string, string>();

  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name && valueParts.length) {
      cookies.set(name, decodeURIComponent(valueParts.join("=")));
    }
  }

  return cookies;
}

function cookieChunkName(name: string, index: number) {
  return `${name}.${index}`;
}

function appendSetCookie(res: Response, cookie: string) {
  const current = res.getHeader("Set-Cookie");

  if (!current) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookie]);
  } else {
    res.setHeader("Set-Cookie", [String(current), cookie]);
  }
}

function cookieString(name: string, value: string, maxAgeSeconds: number) {
  const secure = config.isProduction ? "; Secure" : "";

  return `${name}=${encodeURIComponent(
    value
  )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearCookieString(name: string) {
  const secure = config.isProduction ? "; Secure" : "";

  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

function setChunkedCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  appendSetCookie(res, clearCookieString(name));

  for (let index = 0; index < maxCookieChunks; index += 1) {
    appendSetCookie(res, clearCookieString(cookieChunkName(name, index)));
  }

  const chunks = value.match(new RegExp(`.{1,${maxCookieChunkLength}}`, "g")) ?? [""];

  for (const [index, chunk] of chunks.entries()) {
    appendSetCookie(res, cookieString(cookieChunkName(name, index), chunk, maxAgeSeconds));
  }
}

function clearChunkedCookie(res: Response, name: string) {
  appendSetCookie(res, clearCookieString(name));

  for (let index = 0; index < maxCookieChunks; index += 1) {
    appendSetCookie(res, clearCookieString(cookieChunkName(name, index)));
  }
}

function readChunkedCookie(cookies: Map<string, string>, name: string) {
  const directCookie = cookies.get(name);
  if (directCookie) {
    return directCookie;
  }

  const chunks: string[] = [];

  for (let index = 0; index < maxCookieChunks; index += 1) {
    const chunk = cookies.get(cookieChunkName(name, index));

    if (!chunk) {
      break;
    }

    chunks.push(chunk);
  }

  return chunks.length ? chunks.join("") : undefined;
}

function encodeCookiePayload(value: unknown) {
  return encryptText(JSON.stringify(value), config.appSecret);
}

function decodeCookiePayload<T>(value: string) {
  return JSON.parse(decryptText(value, config.appSecret)) as T;
}

function createSessionPayload(user: UserAccount): StatelessSessionPayload {
  return {
    version: 1,
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      initials: user.initials,
      telegramUserId: user.telegramUserId
    },
    apiId: user.apiId,
    apiHash: user.encryptedApiHash
      ? decryptText(user.encryptedApiHash, config.appSecret)
      : undefined,
    session: decryptText(user.encryptedSession, config.appSecret),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + sessionDurationMs).toISOString()
  };
}

function createSessionToken(user: UserAccount) {
  return encodeCookiePayload(createSessionPayload(user));
}

function setLoginCookie(res: Response, user: UserAccount) {
  const token = createSessionToken(user);

  setChunkedCookie(
    res,
    sessionCookie,
    token,
    Math.floor(sessionDurationMs / 1000)
  );

  return token;
}

function setLoginAttemptCookie(res: Response, attempt: LoginAttempt) {
  setChunkedCookie(
    res,
    loginAttemptCookie,
    encodeCookiePayload(attempt),
    Math.floor(loginDurationMs / 1000)
  );
}

function clearLoginCookie(res: Response) {
  clearChunkedCookie(res, sessionCookie);
}

function clearLoginAttemptCookie(res: Response) {
  clearChunkedCookie(res, loginAttemptCookie);
}

function publicUser(user: UserAccount): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    initials: user.initials
  };
}

function normalizePhone(phone: unknown) {
  if (typeof phone !== "string") {
    return "";
  }

  return phone.replace(/[^\d+]/g, "").trim();
}

function isValidPhone(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function normalizeApiCredentials(body: unknown): TelegramCredentials | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const input = body as { apiId?: unknown; apiHash?: unknown };
  const apiId = Number(input.apiId);
  const apiHash = String(input.apiHash ?? "").trim();

  if (Number.isInteger(apiId) && apiId > 0 && /^[a-f0-9]{32}$/i.test(apiHash)) {
    return { apiId, apiHash };
  }

  return null;
}

function requireApiCredentials(body: unknown) {
  return normalizeApiCredentials(body);
}

function attemptCredentials(attempt: { apiId: number; encryptedApiHash: string }) {
  return {
    apiId: attempt.apiId,
    apiHash: decryptText(attempt.encryptedApiHash, config.appSecret)
  };
}

function safeFilename(filename: string) {
  return filename.replace(/[^\w .()[\]-]/g, "_").slice(0, 180) || "download";
}

function contentDisposition(filename: string) {
  return `attachment; filename="${safeFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(
    filename
  )}`;
}

function inlineContentDisposition(filename: string) {
  return `inline; filename="${safeFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(
    filename
  )}`;
}

function logActivity(
  store: StoreShape,
  input: Omit<ActivityRecord, "id" | "createdAt" | "userId"> & { userId: string }
) {
  const activity: ActivityRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    fileId: input.fileId,
    folderId: input.folderId,
    action: input.action,
    detail: input.detail,
    createdAt: new Date().toISOString()
  };

  store.activities[activity.id] = activity;
  return activity;
}

function isTrashed(file: DriveFileRecord) {
  return Boolean(file.trashedAt);
}

function sortFiles(files: DriveFileRecord[], sort: string, direction: string) {
  const normalizedSort = ["name", "size", "createdAt", "updatedAt"].includes(sort)
    ? sort
    : "updatedAt";
  const multiplier = direction === "asc" ? 1 : -1;

  return [...files].sort((a, b) => {
    if (normalizedSort === "name") {
      return a.name.localeCompare(b.name) * multiplier;
    }

    if (normalizedSort === "size") {
      return (a.size - b.size) * multiplier;
    }

    return (
      (new Date(a[normalizedSort as "createdAt" | "updatedAt"]).getTime() -
        new Date(b[normalizedSort as "createdAt" | "updatedAt"]).getTime()) *
      multiplier
    );
  });
}

function sessionFromStatelessToken(token: string) {
  try {
    const payload = decodeCookiePayload<StatelessSessionPayload>(token);

    if (
      payload.version === 1 &&
      payload.session &&
      payload.user?.id &&
      new Date(payload.expiresAt).getTime() > Date.now()
    ) {
      const now = new Date().toISOString();
      const user: UserAccount = {
        id: payload.user.id,
        phone: payload.user.phone,
        displayName: payload.user.displayName,
        initials: payload.user.initials,
        telegramUserId: payload.user.telegramUserId,
        apiId: payload.apiId,
        encryptedApiHash: payload.apiHash
          ? encryptText(payload.apiHash, config.appSecret)
          : undefined,
        encryptedSession: encryptText(payload.session, config.appSecret),
        createdAt: payload.createdAt,
        updatedAt: now
      };

      return { token, user };
    }
  } catch {
    return null;
  }

  return null;
}

async function getRequestSession(req: Request) {
  const cookies = parseCookies(req);
  const authorization = req.headers.authorization;
  const bearerToken =
    typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : undefined;
  const cookieToken = readChunkedCookie(cookies, sessionCookie);
  const tokens = [bearerToken, cookieToken].filter(
    (token, index, allTokens): token is string => Boolean(token) && allTokens.indexOf(token) === index
  );

  for (const token of tokens) {
    const session = sessionFromStatelessToken(token);
    if (session) {
      return session;
    }
  }

  const opaqueToken = cookies.get(sessionCookie);

  if (!opaqueToken) {
    return null;
  }

  const store = await readStore();
  const webSession = store.webSessions[opaqueToken];

  if (!webSession || new Date(webSession.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = store.users[webSession.userId];
  if (!user) {
    return null;
  }

  return { token: opaqueToken, user };
}

async function requireUser(req: Request, res: Response) {
  const session = await getRequestSession(req);

  if (!session) {
    jsonError(res, 401, "Please sign in again.");
    return null;
  }

  await ensureUserScaffold(session.user);
  return session;
}

async function getLoginAttempt(req: Request, loginId: string) {
  const store = await readStore();
  const storeAttempt = store.loginAttempts[loginId];

  if (storeAttempt) {
    return storeAttempt;
  }

  const cookieValue = readChunkedCookie(parseCookies(req), loginAttemptCookie);
  if (!cookieValue) {
    return null;
  }

  try {
    const attempt = decodeCookiePayload<LoginAttempt>(cookieValue);

    if (attempt.id === loginId && new Date(attempt.expiresAt).getTime() > Date.now()) {
      return attempt;
    }
  } catch {
    return null;
  }

  return null;
}

function createDefaultFolders(userId: string): FolderRecord[] {
  return [
    {
      id: rootFolderId,
      userId,
      name: "Saved Messages",
      createdAt: new Date().toISOString()
    }
  ];
}

async function ensureUserScaffold(user: UserAccount) {
  await mutateStore((store) => {
    store.users[user.id] ??= user;

    for (const folder of createDefaultFolders(user.id)) {
      store.folders[`${user.id}:${folder.id}`] ??= folder;
    }
  });
}

async function importGramDriveFilesFromTelegram(user: UserAccount) {
  const lastImportAt = lastTelegramImportByUser.get(user.id) ?? 0;

  if (Date.now() - lastImportAt < telegramImportCooldownMs) {
    return;
  }

  lastTelegramImportByUser.set(user.id, Date.now());

  const importedFiles = await findGramDriveFiles(user);
  if (!importedFiles.length) {
    return;
  }

  await mutateStore((nextStore) => {
    for (const importedFile of importedFiles) {
      if (nextStore.files[importedFile.id]) {
        continue;
      }

      const folderKey = `${user.id}:${importedFile.folderId}`;
      const folderId = nextStore.folders[folderKey] ? importedFile.folderId : rootFolderId;
      const record: DriveFileRecord = {
        id: importedFile.id,
        userId: user.id,
        folderId,
        messageId: importedFile.messageId,
        name: importedFile.name,
        mimeType: importedFile.mimeType,
        size: importedFile.size,
        createdAt: importedFile.createdAt,
        updatedAt: importedFile.createdAt
      };

      nextStore.files[record.id] = record;
    }
  });
}

async function ensureImportedFiles(user: UserAccount) {
  try {
    await importGramDriveFilesFromTelegram(user);
  } catch {
    // Import is opportunistic. Normal API errors should not block authenticated requests.
  }
}

async function persistSignedInUser(
  phone: string,
  session: string,
  credentials: TelegramCredentials,
  profile: { telegramUserId: string; displayName: string; initials: string }
) {
  const now = new Date().toISOString();
  const token = crypto.randomBytes(32).toString("base64url");

  return mutateStore((store) => {
    const existing = Object.values(store.users).find(
      (user) => user.telegramUserId === profile.telegramUserId
    );

    const userId = existing?.id ?? profile.telegramUserId;
    const user: UserAccount = {
      id: userId,
      phone,
      telegramUserId: profile.telegramUserId,
      displayName: profile.displayName,
      initials: profile.initials,
      apiId: credentials.apiId,
      encryptedApiHash: encryptText(credentials.apiHash, config.appSecret),
      encryptedSession: encryptText(session, config.appSecret),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    store.users[userId] = user;

    for (const folder of createDefaultFolders(userId)) {
      const folderKey = `${userId}:${folder.id}`;
      store.folders[folderKey] ??= folder;
    }

    store.webSessions[token] = {
      token,
      userId,
      createdAt: now,
      expiresAt: new Date(Date.now() + sessionDurationMs).toISOString()
    };

    return { token, user: publicUser(user), account: user };
  });
}

app.get("/api/config", (_req, res) => {
  res.json({
    build: appBuild,
    telegramConfigured: hasTelegramConfig(),
    serverCredentialsAvailable: hasTelegramConfig(),
    userCredentialsEnabled: true,
    maxUploadMb: config.maxUploadMb
  });
});

app.get("/api/auth/me", async (req, res) => {
  const session = await getRequestSession(req);

  if (!session) {
    res.json({ user: null });
    return;
  }

  res.json({ user: publicUser(session.user) });
});

app.post("/api/auth/send-code", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const credentials = requireApiCredentials(req.body);

  if (!isValidPhone(phone)) {
    return jsonError(res, 400, "Use international format, for example +14155552671.");
  }

  if (!credentials) {
    return jsonError(res, 400, "Paste your Telegram API ID and API hash to continue.");
  }

  try {
    const code = await requestLoginCode(phone, credentials);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const attempt: LoginAttempt = {
      id,
      phone,
      apiId: credentials.apiId,
      encryptedApiHash: encryptText(credentials.apiHash, config.appSecret),
      phoneCodeHash: code.phoneCodeHash,
      tempSession: code.tempSession,
      requiresPassword: false,
      createdAt: now,
      expiresAt: new Date(Date.now() + loginDurationMs).toISOString()
    };

    await mutateStore((store) => {
      store.loginAttempts[id] = attempt;
    });

    setLoginAttemptCookie(res, attempt);
    res.json({
      loginId: id,
      timeout: code.timeout
    });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.post("/api/auth/verify-code", async (req, res) => {
  const loginId = String(req.body?.loginId ?? "");
  const code = String(req.body?.code ?? "").replace(/\D/g, "");
  const attempt = await getLoginAttempt(req, loginId);

  if (!attempt) {
    return jsonError(res, 400, "This login attempt expired. Request a new code.");
  }

  if (code.length < 3) {
    return jsonError(res, 400, "Enter the code from Telegram.");
  }

  try {
    const result = await signInWithCode(
      attempt.phone,
      attempt.phoneCodeHash,
      code,
      attempt.tempSession,
      attemptCredentials(attempt)
    );

    if (result.status === "password_required") {
      const nextAttempt: LoginAttempt = {
        ...attempt,
        requiresPassword: true,
        tempSession: result.tempSession
      };

      await mutateStore((nextStore) => {
        if (nextStore.loginAttempts[loginId]) {
          nextStore.loginAttempts[loginId].requiresPassword = true;
          nextStore.loginAttempts[loginId].tempSession = result.tempSession;
        }
      });

      setLoginAttemptCookie(res, nextAttempt);
      res.json({ requiresPassword: true });
      return;
    }

    const signedIn = await persistSignedInUser(
      attempt.phone,
      result.session,
      attemptCredentials(attempt),
      result.profile
    );

    await mutateStore((nextStore) => {
      delete nextStore.loginAttempts[loginId];
    });

    clearLoginAttemptCookie(res);
    const authToken = setLoginCookie(res, signedIn.account);
    res.json({ user: signedIn.user, authToken });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.post("/api/auth/verify-password", async (req, res) => {
  const loginId = String(req.body?.loginId ?? "");
  const password = String(req.body?.password ?? "");
  const attempt = await getLoginAttempt(req, loginId);

  if (!attempt || !attempt.requiresPassword) {
    return jsonError(res, 400, "This password check expired. Request a new code.");
  }

  if (!password) {
    return jsonError(res, 400, "Enter your Telegram two-step verification password.");
  }

  try {
    const credentials = attemptCredentials(attempt);
    const result = await signInWithPassword(password, attempt.tempSession, credentials);
    const signedIn = await persistSignedInUser(
      attempt.phone,
      result.session,
      credentials,
      result.profile
    );

    await mutateStore((nextStore) => {
      delete nextStore.loginAttempts[loginId];
    });

    clearLoginAttemptCookie(res);
    const authToken = setLoginCookie(res, signedIn.account);
    res.json({ user: signedIn.user, authToken });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseCookies(req).get(sessionCookie);

  if (token) {
    await mutateStore((store) => {
      delete store.webSessions[token];
    });
  }

  clearLoginCookie(res);
  res.json({ ok: true });
});

app.get("/api/folders", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const folders = Object.values(store.folders)
    .filter((folder) => folder.userId === session.user.id)
    .sort((a, b) => {
      if (a.id === rootFolderId) return -1;
      if (b.id === rootFolderId) return 1;
      return a.name.localeCompare(b.name);
    });

  res.json({ folders });
});

app.get("/api/telegram/channels", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  try {
    const channels = await listCreatedChannels(session.user);
    res.json({ channels });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.post("/api/folders", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) {
    return jsonError(res, 400, "Folder name is required.");
  }

  const folder = await mutateStore((store) => {
    const nextFolder: FolderRecord = {
      id: crypto.randomUUID(),
      userId: session.user.id,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    store.folders[`${session.user.id}:${nextFolder.id}`] = nextFolder;
    logActivity(store, {
      userId: session.user.id,
      folderId: nextFolder.id,
      action: "created_folder",
      detail: `Created folder ${nextFolder.name}`
    });
    return nextFolder;
  });

  res.status(201).json({ folder });
});

app.patch("/api/folders/:id", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const folderId = String(req.params.id ?? "");
  const name = String(req.body?.name ?? "").trim().slice(0, 60);

  if (folderId === rootFolderId) {
    return jsonError(res, 400, "Saved Messages cannot be renamed.");
  }

  if (!name) {
    return jsonError(res, 400, "Folder name is required.");
  }

  const folder = await mutateStore((store) => {
    const folderKey = `${session.user.id}:${folderId}`;
    const existing = store.folders[folderKey];

    if (!existing) {
      return null;
    }

    existing.name = name;
    existing.updatedAt = new Date().toISOString();
    logActivity(store, {
      userId: session.user.id,
      folderId,
      action: "renamed_folder",
      detail: `Renamed folder to ${name}`
    });
    return existing;
  });

  if (!folder) {
    return jsonError(res, 404, "Folder not found.");
  }

  res.json({ folder });
});

app.delete("/api/folders/:id", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const folderId = String(req.params.id ?? "");

  if (folderId === rootFolderId) {
    return jsonError(res, 400, "Saved Messages cannot be deleted.");
  }

  const result = await mutateStore((store) => {
    const folderKey = `${session.user.id}:${folderId}`;
    const existing = store.folders[folderKey];

    if (!existing) {
      return null;
    }

    delete store.folders[folderKey];
    logActivity(store, {
      userId: session.user.id,
      folderId,
      action: "deleted_folder",
      detail: `Deleted folder ${existing.name}`
    });

    let movedFiles = 0;
    for (const file of Object.values(store.files)) {
      if (file.userId === session.user.id && file.folderId === folderId) {
        file.folderId = rootFolderId;
        file.updatedAt = new Date().toISOString();
        movedFiles += 1;
      }
    }

    return { ok: true as const, movedFiles };
  });

  if (!result) {
    return jsonError(res, 404, "Folder not found.");
  }

  res.json(result);
});

app.get("/api/files", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  await ensureImportedFiles(session.user);

  const folderId = String(req.query.folderId ?? rootFolderId);
  const search = String(req.query.search ?? "").toLowerCase();
  const view = String(req.query.view ?? "folder");
  const sort = String(req.query.sort ?? "updatedAt");
  const direction = String(req.query.direction ?? "desc");
  const store = await readStore();
  let files = Object.values(store.files).filter((file) => file.userId === session.user.id);

  if (view === "trash") {
    files = files.filter(isTrashed);
  } else {
    files = files.filter((file) => !isTrashed(file));

    if (view === "recent") {
      files = files.sort(
        (a, b) =>
          new Date(b.lastOpenedAt ?? b.updatedAt).getTime() -
          new Date(a.lastOpenedAt ?? a.updatedAt).getTime()
      );
    } else if (view === "starred") {
      files = files.filter((file) => file.starred);
    } else if (view === "home") {
      files = files.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() -
          new Date(a.updatedAt).getTime()
      );
    } else {
      files = files.filter((file) => file.folderId === folderId);
    }
  }

  files = files.filter((file) => !search || file.name.toLowerCase().includes(search));

  if (view !== "recent" && view !== "home") {
    files = sortFiles(files, sort, direction);
  }

  res.json({ files });
});

app.get("/api/files/summary", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  await ensureImportedFiles(session.user);

  const store = await readStore();
  const files = Object.values(store.files).filter(
    (file) => file.userId === session.user.id && !isTrashed(file)
  );
  const allUserFiles = Object.values(store.files).filter((file) => file.userId === session.user.id);

  res.json({
    totalFiles: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    trashedFiles: allUserFiles.filter(isTrashed).length,
    starredFiles: files.filter((file) => file.starred).length
  });
});

app.get("/api/activity", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const limit = Math.min(Number(req.query.limit ?? 20), 50);
  const activities = Object.values(store.activities)
    .filter((activity) => activity.userId === session.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json({ activities });
});

app.post("/api/files/upload", upload.single("file"), async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const uploadedFile = req.file;
  if (!uploadedFile) {
    return jsonError(res, 400, "Choose a file to upload.");
  }

  const folderId = String(req.body?.folderId ?? rootFolderId);
  const fileId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const metadata = {
    app: "GramDrive",
    id: fileId,
    folderId,
    name: uploadedFile.originalname,
    size: uploadedFile.size,
    mimeType: uploadedFile.mimetype,
    uploadedAt: createdAt
  };

  try {
    const messageId = await withUserClient(session.user, async (client) => {
      const message = (await client.sendFile("me", {
        file: uploadedFile.path,
        forceDocument: true,
        caption: `GramDrive\n${JSON.stringify(metadata)}`
      })) as { id?: number } | Array<{ id?: number }>;

      const sentMessage = Array.isArray(message) ? message[0] : message;
      if (!sentMessage?.id) {
        throw new Error("Telegram did not return a message id for this upload.");
      }

      return Number(sentMessage.id);
    });

    const record: DriveFileRecord = {
      id: fileId,
      userId: session.user.id,
      folderId,
      messageId,
      name: uploadedFile.originalname,
      mimeType: uploadedFile.mimetype || "application/octet-stream",
      size: uploadedFile.size,
      createdAt,
      updatedAt: createdAt
    };

    await mutateStore((store) => {
      store.files[fileId] = record;
      logActivity(store, {
        userId: session.user.id,
        fileId,
        folderId,
        action: "uploaded_file",
        detail: `Uploaded ${uploadedFile.originalname}`
      });
    });

    res.status(201).json({ file: record });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  } finally {
    await fs.rm(uploadedFile.path, { force: true });
  }
});

app.patch("/api/files/:id", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 180) : undefined;
  const folderId = typeof req.body?.folderId === "string" ? req.body.folderId : undefined;
  const starred = typeof req.body?.starred === "boolean" ? req.body.starred : undefined;
  const markOpened = Boolean(req.body?.markOpened);

  try {
    const file = await mutateStore((store) => {
      const existing = store.files[req.params.id];
      if (!existing || existing.userId !== session.user.id) {
        return null;
      }

      if (name) {
        existing.name = name;
        logActivity(store, {
          userId: session.user.id,
          fileId: existing.id,
          folderId: existing.folderId,
          action: "renamed_file",
          detail: `Renamed file to ${name}`
        });
      }

      if (folderId) {
        const folder = store.folders[`${session.user.id}:${folderId}`];
        if (!folder) {
          throw new Error("Folder not found.");
        }

        existing.folderId = folderId;
        existing.deletedOriginalFolderId = undefined;
        existing.trashedAt = undefined;
        logActivity(store, {
          userId: session.user.id,
          fileId: existing.id,
          folderId,
          action: "moved_file",
          detail: `Moved ${existing.name} to ${folder.name}`
        });
      }

      if (typeof starred === "boolean") {
        existing.starred = starred;
        logActivity(store, {
          userId: session.user.id,
          fileId: existing.id,
          folderId: existing.folderId,
          action: starred ? "starred_file" : "unstarred_file",
          detail: `${starred ? "Starred" : "Unstarred"} ${existing.name}`
        });
      }

      if (markOpened) {
        existing.lastOpenedAt = new Date().toISOString();
      }

      existing.updatedAt = new Date().toISOString();
      return existing;
    });

    if (!file) {
      return jsonError(res, 404, "File not found.");
    }

    res.json({ file });
  } catch (error) {
    jsonError(res, 400, error instanceof Error ? error.message : "Unable to update file.");
  }
});

app.post("/api/files/:id/restore", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const file = await mutateStore((store) => {
    const existing = store.files[req.params.id];
    if (!existing || existing.userId !== session.user.id) {
      return null;
    }

    const restoreFolderId = existing.deletedOriginalFolderId ?? rootFolderId;
    const restoreFolder = store.folders[`${session.user.id}:${restoreFolderId}`];
    existing.folderId = restoreFolder ? restoreFolderId : rootFolderId;
    existing.trashedAt = undefined;
    existing.deletedOriginalFolderId = undefined;
    existing.updatedAt = new Date().toISOString();
    logActivity(store, {
      userId: session.user.id,
      fileId: existing.id,
      folderId: existing.folderId,
      action: "restored_file",
      detail: `Restored ${existing.name}`
    });
    return existing;
  });

  if (!file) {
    return jsonError(res, 404, "File not found.");
  }

  res.json({ file });
});

app.get("/api/files/:id/download", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const file = store.files[req.params.id];

  if (!file || file.userId !== session.user.id) {
    return jsonError(res, 404, "File not found.");
  }

  try {
    await mutateStore((nextStore) => {
      const existing = nextStore.files[file.id];
      if (existing) {
        existing.lastOpenedAt = new Date().toISOString();
        existing.updatedAt = new Date().toISOString();
        logActivity(nextStore, {
          userId: session.user.id,
          fileId: existing.id,
          folderId: existing.folderId,
          action: "downloaded_file",
          detail: `Downloaded ${existing.name}`
        });
      }
    });

    const media = await withUserClient(session.user, async (client) => {
      const messages = (await client.getMessages("me", { ids: [file.messageId] })) as unknown[];
      const message = Array.isArray(messages) ? messages[0] : messages;

      if (!message) {
        throw new Error("Telegram message was not found.");
      }

      return client.downloadMedia(message as never, {}) as Promise<Buffer>;
    });

    if (!Buffer.isBuffer(media)) {
      throw new Error("Telegram did not return file bytes.");
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(media.length));
    res.setHeader("Content-Disposition", contentDisposition(file.name));
    res.send(media);
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.get("/api/files/:id/preview", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const file = store.files[req.params.id];

  if (!file || file.userId !== session.user.id) {
    return jsonError(res, 404, "File not found.");
  }

  if (!file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/")) {
    return jsonError(res, 415, "Preview is available for images and videos.");
  }

  try {
    await mutateStore((nextStore) => {
      const existing = nextStore.files[file.id];
      if (existing) {
        existing.lastOpenedAt = new Date().toISOString();
        logActivity(nextStore, {
          userId: session.user.id,
          fileId: existing.id,
          folderId: existing.folderId,
          action: "previewed_file",
          detail: `Previewed ${existing.name}`
        });
      }
    });

    const media = await withUserClient(session.user, async (client) => {
      const messages = (await client.getMessages("me", { ids: [file.messageId] })) as unknown[];
      const message = Array.isArray(messages) ? messages[0] : messages;

      if (!message) {
        throw new Error("Telegram message was not found.");
      }

      return client.downloadMedia(message as never, {}) as Promise<Buffer>;
    });

    if (!Buffer.isBuffer(media)) {
      throw new Error("Telegram did not return file bytes.");
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(media.length));
    res.setHeader("Content-Disposition", inlineContentDisposition(file.name));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(media);
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.delete("/api/files/:id", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const file = store.files[req.params.id];

  if (!file || file.userId !== session.user.id) {
    return jsonError(res, 404, "File not found.");
  }

  try {
    await mutateStore((nextStore) => {
      const existing = nextStore.files[file.id];
      if (!existing) return;
      existing.deletedOriginalFolderId = existing.folderId;
      existing.trashedAt = new Date().toISOString();
      existing.starred = false;
      existing.updatedAt = new Date().toISOString();
      logActivity(nextStore, {
        userId: session.user.id,
        fileId: existing.id,
        folderId: existing.folderId,
        action: "trashed_file",
        detail: `Moved ${existing.name} to Trash`
      });
    });

    res.json({ ok: true });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

app.delete("/api/files/:id/permanent", async (req, res) => {
  const session = await requireUser(req, res);
  if (!session) return;

  const store = await readStore();
  const file = store.files[req.params.id];

  if (!file || file.userId !== session.user.id) {
    return jsonError(res, 404, "File not found.");
  }

  try {
    await withUserClient(session.user, async (client) => {
      await client.deleteMessages("me", [file.messageId], { revoke: true });
    });

    await mutateStore((nextStore) => {
      delete nextStore.files[file.id];
      logActivity(nextStore, {
        userId: session.user.id,
        fileId: file.id,
        folderId: file.folderId,
        action: "deleted_file_permanently",
        detail: `Permanently deleted ${file.name}`
      });
    });

    res.json({ ok: true });
  } catch (error) {
    jsonError(res, 400, toTelegramError(error));
  }
});

if (!process.env.VERCEL) {
  if (config.isProduction) {
    const clientPath = path.resolve(process.cwd(), "dist/client");
    app.use(express.static(clientPath));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientPath, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });

    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, () => {
    console.log(`GramDrive is running at http://localhost:${config.port}`);
  });

  process.on("SIGTERM", () => {
    server.close();
  });
}

export default app;
