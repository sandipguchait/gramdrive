export type PublicUser = {
  id: string;
  phone: string;
  displayName: string;
  initials: string;
};

export type AuthenticatedUserResponse = {
  user: PublicUser;
  authToken?: string;
};

export type AppConfig = {
  telegramConfigured: boolean;
  serverCredentialsAvailable: boolean;
  userCredentialsEnabled: boolean;
  maxUploadMb: number;
};

export type FolderRecord = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
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

export type StorageSummary = {
  totalFiles: number;
  totalSize: number;
  trashedFiles: number;
  starredFiles: number;
};

export type DriveViewKey = "home" | "folder" | "recent" | "starred" | "trash";

export type FileSortKey = "name" | "size" | "createdAt" | "updatedAt";

export type FileQuery = {
  folderId?: string;
  search?: string;
  view?: DriveViewKey;
  sort?: FileSortKey;
  direction?: "asc" | "desc";
};

export type LoginCodeResponse = {
  loginId: string;
  timeout: number;
};

export type VerifyCodeResponse =
  | {
      requiresPassword: true;
      user?: never;
      authToken?: never;
    }
  | (AuthenticatedUserResponse & {
      requiresPassword?: false;
    });
