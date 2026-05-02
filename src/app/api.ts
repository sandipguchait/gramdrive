import type {
  ActivityRecord,
  AuthenticatedUserResponse,
  AppConfig,
  DriveFileRecord,
  FileQuery,
  FolderRecord,
  LoginCodeResponse,
  PublicUser,
  StorageSummary,
  VerifyCodeResponse
} from "./types";

const authTokenKey = "gramdrive.authToken";

function getStoredAuthToken() {
  try {
    return window.localStorage.getItem(authTokenKey);
  } catch {
    return null;
  }
}

function saveAuthToken(token?: string) {
  if (!token) return;

  try {
    window.localStorage.setItem(authTokenKey, token);
  } catch {
    // Cookies remain the fallback when storage is unavailable.
  }
}

export function clearAuthToken() {
  try {
    window.localStorage.removeItem(authTokenKey);
  } catch {
    // Ignore storage failures.
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }

    throw new Error(payload.error ?? "Something went wrong.");
  }

  return payload as T;
}

export async function api<T>(path: string, init?: RequestInit) {
  const token = getStoredAuthToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });

  return parseResponse<T>(response);
}

export const DriveApi = {
  config: () => api<AppConfig>("/api/config"),
  me: () => api<{ user: PublicUser | null }>("/api/auth/me"),
  sendCode: (phone: string, apiId: string, apiHash: string) =>
    api<LoginCodeResponse>("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ phone, apiId, apiHash })
    }),
  verifyCode: async (loginId: string, code: string) => {
    const result = await api<VerifyCodeResponse>("/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ loginId, code })
    });

    if (!result.requiresPassword) {
      saveAuthToken(result.authToken);
    }

    return result;
  },
  verifyPassword: async (loginId: string, password: string) => {
    const result = await api<AuthenticatedUserResponse>("/api/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({ loginId, password })
    });

    saveAuthToken(result.authToken);
    return result;
  },
  logout: async () => {
    try {
      return await api<{ ok: true }>("/api/auth/logout", {
        method: "POST"
      });
    } finally {
      clearAuthToken();
    }
  },
  folders: () => api<{ folders: FolderRecord[] }>("/api/folders"),
  createFolder: (name: string) =>
    api<{ folder: FolderRecord }>("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  renameFolder: (id: string, name: string) =>
    api<{ folder: FolderRecord }>(`/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),
  deleteFolder: (id: string) =>
    api<{ ok: true; movedFiles: number }>(`/api/folders/${id}`, {
      method: "DELETE"
    }),
  files: (query: FileQuery) => {
    const params = new URLSearchParams();
    if (query.folderId) params.set("folderId", query.folderId);
    if (query.search) params.set("search", query.search);
    if (query.view) params.set("view", query.view);
    if (query.sort) params.set("sort", query.sort);
    if (query.direction) params.set("direction", query.direction);
    return api<{ files: DriveFileRecord[] }>(`/api/files?${params.toString()}`);
  },
  storageSummary: () => api<StorageSummary>("/api/files/summary"),
  activity: () => api<{ activities: ActivityRecord[] }>("/api/activity"),
  updateFile: (id: string, patch: Partial<Pick<DriveFileRecord, "name" | "folderId" | "starred">>) =>
    api<{ file: DriveFileRecord }>(`/api/files/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  markFileOpened: (id: string) =>
    api<{ file: DriveFileRecord }>(`/api/files/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ markOpened: true })
    }),
  restoreFile: (id: string) =>
    api<{ file: DriveFileRecord }>(`/api/files/${id}/restore`, {
      method: "POST"
    }),
  deleteFile: (id: string) =>
    api<{ ok: true }>(`/api/files/${id}`, {
      method: "DELETE"
    }),
  permanentlyDeleteFile: (id: string) =>
    api<{ ok: true }>(`/api/files/${id}/permanent`, {
      method: "DELETE"
    })
};

export function uploadDriveFile(
  file: File,
  folderId: string,
  onProgress: (progress: number) => void
) {
  const form = new FormData();
  form.append("file", file);
  form.append("folderId", folderId);

  return new Promise<DriveFileRecord>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const token = getStoredAuthToken();
    request.open("POST", "/api/files/upload");

    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      try {
        const payload = JSON.parse(request.responseText || "{}");
        if (request.status >= 200 && request.status < 300) {
          resolve(payload.file as DriveFileRecord);
        } else {
          reject(new Error(payload.error ?? "Upload failed."));
        }
      } catch (error) {
        reject(error);
      }
    });

    request.addEventListener("error", () => {
      reject(new Error("Upload failed."));
    });

    request.send(form);
  });
}
