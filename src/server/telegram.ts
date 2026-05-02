import { Api, TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { StringSession } from "telegram/sessions/index.js";
import { decryptText } from "./crypto.js";
import { config, requireTelegramConfig } from "./config.js";
import type { TelegramCredentials, TelegramProfile, UserAccount } from "./types.js";

type LoginSuccess = {
  status: "signed_in";
  session: string;
  profile: TelegramProfile;
};

type PasswordRequired = {
  status: "password_required";
  tempSession: string;
};

function getSessionValue(client: TelegramClient) {
  return (client.session as unknown as { save: () => string }).save();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function isPasswordRequired(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes("SESSION_PASSWORD_NEEDED");
}

export function toTelegramError(error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("PHONE_CODE_INVALID")) {
    return "The code was not accepted by Telegram.";
  }

  if (message.includes("PHONE_CODE_EXPIRED")) {
    return "The Telegram code has expired. Request a new code.";
  }

  if (message.includes("PHONE_NUMBER_INVALID")) {
    return "Telegram did not accept that phone number.";
  }

  if (message.includes("FLOOD")) {
    return "Telegram is rate limiting this login. Please wait before trying again.";
  }

  if (message.includes("PASSWORD_HASH_INVALID")) {
    return "The two-step verification password was not accepted.";
  }

  return message;
}

function normalizeProfile(rawUser: unknown): TelegramProfile {
  const user = rawUser as {
    id?: { toString: () => string } | number | string;
    firstName?: string;
    lastName?: string;
    username?: string;
  };

  const firstName = user.firstName?.trim() ?? "";
  const lastName = user.lastName?.trim() ?? "";
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    user.username ||
    "Telegram User";

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return {
    telegramUserId: user.id?.toString() ?? crypto.randomUUID(),
    displayName,
    initials: initials || "TU"
  };
}

function resolveCredentials(credentials?: TelegramCredentials): TelegramCredentials {
  if (credentials) {
    return credentials;
  }

  return requireTelegramConfig();
}

function userCredentials(user: UserAccount): TelegramCredentials {
  if (user.apiId && user.encryptedApiHash) {
    return {
      apiId: user.apiId,
      apiHash: decryptText(user.encryptedApiHash, config.appSecret)
    };
  }

  return requireTelegramConfig();
}

export async function createTelegramClient(session = "", credentials?: TelegramCredentials) {
  const { apiId, apiHash } = resolveCredentials(credentials);
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();
  return client;
}

export async function requestLoginCode(phone: string, credentials: TelegramCredentials) {
  const { apiId, apiHash } = credentials;
  const client = await createTelegramClient("", credentials);

  try {
    const sentCode = (await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({})
      })
    )) as { phoneCodeHash: string; timeout?: number };

    return {
      phoneCodeHash: sentCode.phoneCodeHash,
      tempSession: getSessionValue(client),
      timeout: sentCode.timeout ?? 120
    };
  } finally {
    await client.disconnect();
  }
}

export async function signInWithCode(
  phone: string,
  phoneCodeHash: string,
  code: string,
  tempSession: string,
  credentials: TelegramCredentials
): Promise<LoginSuccess | PasswordRequired> {
  const client = await createTelegramClient(tempSession, credentials);

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code
      })
    );

    const profile = normalizeProfile(await client.getMe());

    return {
      status: "signed_in",
      session: getSessionValue(client),
      profile
    };
  } catch (error) {
    if (isPasswordRequired(error)) {
      return {
        status: "password_required",
        tempSession: getSessionValue(client)
      };
    }

    throw error;
  } finally {
    await client.disconnect();
  }
}

export async function signInWithPassword(
  password: string,
  tempSession: string,
  credentials: TelegramCredentials
): Promise<LoginSuccess> {
  const client = await createTelegramClient(tempSession, credentials);

  try {
    const passwordInfo = (await client.invoke(new Api.account.GetPassword())) as Parameters<
      typeof computeCheck
    >[0];
    const passwordCheck = await computeCheck(passwordInfo, password);

    await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

    const profile = normalizeProfile(await client.getMe());

    return {
      status: "signed_in",
      session: getSessionValue(client),
      profile
    };
  } finally {
    await client.disconnect();
  }
}

export async function withUserClient<T>(
  user: UserAccount,
  callback: (client: TelegramClient) => Promise<T>
) {
  const session = decryptText(user.encryptedSession, config.appSecret);
  const client = await createTelegramClient(session, userCredentials(user));

  try {
    return await callback(client);
  } finally {
    await client.disconnect();
  }
}
