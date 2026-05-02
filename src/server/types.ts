export type PublicUser = {
  id: string;
  phone: string;
  displayName: string;
  initials: string;
};

export type UserAccount = PublicUser & {
  telegramUserId: string;
  apiId?: number;
  encryptedApiHash?: string;
  encryptedSession: string;
  createdAt: string;
  updatedAt: string;
};

export type LoginAttempt = {
  id: string;
  phone: string;
  apiId: number;
  encryptedApiHash: string;
  phoneCodeHash: string;
  tempSession: string;
  requiresPassword: boolean;
  createdAt: string;
  expiresAt: string;
};

export type WebSession = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type FolderRecord = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
};

export type TelegramChannelRecord = {
  id: string;
  title: string;
  username?: string;
  participantsCount?: number;
  isPrivate: boolean;
};

export type DriveFileRecord = {
  id: string;
  userId: string;
  folderId: string;
  messageId: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  starred?: boolean;
  trashedAt?: string;
  lastOpenedAt?: string;
  deletedOriginalFolderId?: string;
};

export type ActivityRecord = {
  id: string;
  userId: string;
  fileId?: string;
  folderId?: string;
  action: string;
  detail: string;
  createdAt: string;
};

export type StoreShape = {
  users: Record<string, UserAccount>;
  loginAttempts: Record<string, LoginAttempt>;
  webSessions: Record<string, WebSession>;
  folders: Record<string, FolderRecord>;
  files: Record<string, DriveFileRecord>;
  activities: Record<string, ActivityRecord>;
};

export type TelegramProfile = {
  telegramUserId: string;
  displayName: string;
  initials: string;
};

export type TelegramCredentials = {
  apiId: number;
  apiHash: string;
};
