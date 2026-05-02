import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

export type AppConfig = {
  apiId?: number;
  apiHash?: string;
  appSecret: string;
  dataDir: string;
  maxUploadMb: number;
  port: number;
  isProduction: boolean;
};

function readAppSecret() {
  if (process.env.APP_SECRET) {
    return process.env.APP_SECRET;
  }

  if (isProduction) {
    throw new Error("APP_SECRET is required in production.");
  }

  return "development-only-secret-change-before-deploying";
}

function readApiId() {
  if (!process.env.TELEGRAM_API_ID) {
    return undefined;
  }

  const apiId = Number(process.env.TELEGRAM_API_ID);
  if (!Number.isInteger(apiId)) {
    throw new Error("TELEGRAM_API_ID must be an integer.");
  }

  return apiId;
}

export const config: AppConfig = {
  apiId: readApiId(),
  apiHash: process.env.TELEGRAM_API_HASH,
  appSecret: readAppSecret(),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "data"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 100),
  port: Number(process.env.PORT ?? 4173),
  isProduction
};

export function requireTelegramConfig() {
  if (!config.apiId || !config.apiHash) {
    throw new Error(
      "Telegram API credentials are missing. Set TELEGRAM_API_ID and TELEGRAM_API_HASH."
    );
  }

  return {
    apiId: config.apiId,
    apiHash: config.apiHash
  };
}

export function hasTelegramConfig() {
  return Boolean(config.apiId && config.apiHash);
}
