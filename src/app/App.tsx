import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  Download,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderInput,
  Folder,
  Grid3X3,
  HardDrive,
  Home,
  Images,
  Info,
  KeyRound,
  List,
  Loader2,
  Lock,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DriveApi, uploadDriveFile } from "./api";
import {
  deleteGalleryQueueItem,
  listGalleryQueue,
  queueGalleryFiles,
  readGalleryQueueItem,
  type GalleryQueueItem
} from "./gallerySync";
import type {
  AppConfig,
  DriveFileRecord,
  DriveViewKey,
  FileSortKey,
  FolderRecord,
  PublicUser,
  StorageSummary,
  TelegramChannelRecord
} from "./types";

const rootFolderId = "root";

type ViewMode = "grid" | "list";
type LoginStep = "phone" | "code" | "password";

type UploadState = {
  name: string;
  progress: number;
};

type RenameTarget =
  | {
      kind: "file";
      id: string;
      name: string;
    }
  | {
      kind: "folder";
      id: string;
      name: string;
    }
  | {
      kind: "new-folder";
      id: string;
      name: string;
    }
  | null;

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
};

type PreviewFile = DriveFileRecord | null;

const fileIcons = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  document: FileText,
  file: File
};

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <img src="/brand-icon.svg" alt="" />
    </span>
  );
}

function formatBytes(value: number) {
  if (!value) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);

  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function getFileKind(file: DriveFileRecord) {
  if (file.mimeType.startsWith("image/")) return "image";
  if (file.mimeType.startsWith("video/")) return "video";
  if (file.mimeType.startsWith("audio/")) return "audio";
  if (
    file.mimeType.includes("zip") ||
    file.mimeType.includes("tar") ||
    file.mimeType.includes("rar") ||
    file.name.match(/\.(zip|rar|7z|tar|gz)$/i)
  ) {
    return "archive";
  }
  if (
    file.mimeType.includes("pdf") ||
    file.mimeType.includes("text") ||
    file.name.match(/\.(pdf|txt|md|doc|docx|xls|xlsx|ppt|pptx)$/i)
  ) {
    return "document";
  }

  return "file";
}

function Button({
  children,
  className = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className={`button ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <Loader2 className="spin" size={17} /> : children}
    </button>
  );
}

function IconButton({
  label,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={`icon-button ${className}`} {...props}>
      {children}
    </button>
  );
}

function ConfirmDialog({
  dialog,
  busy,
  onCancel,
  onConfirm
}: {
  dialog: ConfirmDialogOptions | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!dialog) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, onCancel]);

  if (!dialog) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="confirm-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={dialog.destructive ? "confirm-icon destructive" : "confirm-icon"}>
          <Trash2 size={24} />
        </div>
        <div className="confirm-copy">
          <h2 id="confirm-title">{dialog.title}</h2>
          <p id="confirm-message">{dialog.message}</p>
        </div>
        <div className="confirm-actions">
          <Button type="button" disabled={busy} onClick={onCancel}>
            {dialog.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            busy={busy}
            className={dialog.destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {dialog.confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

function RenameDialog({
  file,
  busy,
  onCancel,
  onSubmit
}: {
  file: RenameTarget;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!file) return;

    setName(file.name);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [file, onCancel]);

  if (!file) return null;

  const trimmedName = name.trim();
  const unchanged = trimmedName === file.name;
  const isCreatingFolder = file.kind === "new-folder";
  const targetLabel = file.kind === "file" ? "file" : "folder";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        aria-labelledby="rename-title"
        aria-modal="true"
        className="rename-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName || unchanged) {
            onCancel();
            return;
          }
          onSubmit(trimmedName);
        }}
      >
        <div className="confirm-icon">
          <Pencil size={23} />
        </div>
        <div className="rename-copy">
          <h2 id="rename-title">{isCreatingFolder ? "New folder" : `Rename ${targetLabel}`}</h2>
          <p title={file.name}>
            {isCreatingFolder ? "Create a folder in My Drive." : file.name}
          </p>
        </div>
        <label className="rename-field">
          Name
          <input
            ref={inputRef}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="confirm-actions">
          <Button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} className="primary" disabled={!trimmedName}>
            {isCreatingFolder ? "Create Folder" : "Update Name"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function PreviewModal({
  file,
  onClose,
  onDetails
}: {
  file: PreviewFile;
  onClose: () => void;
  onDetails: (file: DriveFileRecord) => void;
}) {
  const [previewShape, setPreviewShape] = useState<"landscape" | "portrait" | "square">(
    "landscape"
  );

  useEffect(() => {
    if (!file) return;

    setPreviewShape("landscape");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [file, onClose]);

  if (!file) return null;

  const canPreview = file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/");
  const previewUrl = `/api/files/${file.id}/preview`;
  const updatePreviewShape = (width: number, height: number) => {
    if (!width || !height) return;

    if (height > width * 1.12) {
      setPreviewShape("portrait");
    } else if (width > height * 1.12) {
      setPreviewShape("landscape");
    } else {
      setPreviewShape("square");
    }
  };

  return (
    <div className="preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        aria-label={`Preview ${file.name}`}
        className={`preview-modal ${previewShape}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <strong title={file.name}>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
          <div className="preview-actions">
            <a
              className="icon-button"
              aria-label={`Download ${file.name}`}
              title={`Download ${file.name}`}
              href={`/api/files/${file.id}/download`}
            >
              <Download size={17} />
            </a>
            <IconButton label={`Details for ${file.name}`} onClick={() => onDetails(file)}>
              <Info size={17} />
            </IconButton>
            <IconButton label="Close preview" onClick={onClose}>
              <X size={17} />
            </IconButton>
          </div>
        </header>

        <div className="preview-stage">
          {file.mimeType.startsWith("image/") && (
            <img
              alt={file.name}
              className="preview-media"
              onLoad={(event) =>
                updatePreviewShape(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
              }
              src={previewUrl}
            />
          )}
          {file.mimeType.startsWith("video/") && (
            <video
              className="preview-media"
              controls
              onLoadedMetadata={(event) =>
                updatePreviewShape(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
              }
              playsInline
              src={previewUrl}
            />
          )}
          {!canPreview && (
            <div className="preview-unavailable">
              <FileGlyph file={file} />
              <strong>Preview unavailable</strong>
              <p>This file type can be downloaded or inspected in Details.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LandingView({ onGetStarted }: { onGetStarted: () => void }) {
  const featureItems = [
    {
      icon: ShieldCheck,
      title: "Private storage layer",
      copy: "Use your Telegram account as the storage backbone while GramDrive adds a polished web drive on top."
    },
    {
      icon: Search,
      title: "Fast file work",
      copy: "Search, sort, preview, rename, star, and organize files with a focused desktop-class interface."
    },
    {
      icon: KeyRound,
      title: "User-owned access",
      copy: "Each user connects with their own Telegram API credentials and phone number before entering the drive."
    }
  ];

  return (
    <main className="landing-shell" id="top">
      <nav className="landing-nav" aria-label="GramDrive">
        <a className="landing-brand" href="#top">
          <BrandMark className="navicon" />
          <span>GramDrive</span>
        </a>
        <div className="landing-links">
          <a href="#interface">Interface</a>
          <a href="#security">Security</a>
          <Button type="button" className="primary" onClick={onGetStarted}>
            Start
          </Button>
        </div>
      </nav>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-scene" aria-hidden="true">
          <div className="scene-dashboard">
            <div className="scene-sidebar">
              <div className="scene-brand">
                <BrandMark className="tiny" />
                <span>GramDrive</span>
              </div>
              <div className="scene-storage">
                <HardDrive size={16} />
                <strong>128.4 GB</strong>
              </div>
              <span className="scene-nav active">Home</span>
              <span className="scene-nav">Recent</span>
              <span className="scene-nav">Starred</span>
              <span className="scene-nav">Trash</span>
            </div>
            <div className="scene-main">
              <div className="scene-toolbar">
                <span className="scene-search">
                  <Search size={14} />
                  Search files
                </span>
                <span className="scene-upload">
                  <Upload size={14} />
                  Upload
                </span>
              </div>
              <div className="scene-stats">
                <span>
                  <strong>248</strong>
                  Files
                </span>
                <span>
                  <strong>36</strong>
                  Starred
                </span>
                <span>
                  <strong>12</strong>
                  Folders
                </span>
              </div>
              <div className="scene-files">
                <span className="scene-file image">
                  <FileImage size={20} />
                  Design-kit.png
                </span>
                <span className="scene-file video">
                  <FileVideo size={20} />
                  Launch-video.mp4
                </span>
                <span className="scene-file document">
                  <FileText size={20} />
                  Strategy.pdf
                </span>
              </div>
            </div>
          </div>

          <div className="scene-phone">
            <div className="scene-phone-bar" />
            <BrandMark className="tiny" />
            <strong>Secure Telegram login</strong>
            <span>API key</span>
            <span>Phone number</span>
            <em>2FA ready</em>
          </div>
        </div>

        <div className="landing-copy">
          <p className="eyebrow">Telegram-native cloud storage</p>
          <h1 id="landing-title">GramDrive</h1>
          <p>
            A premium web drive that turns Telegram Saved Messages into a clean, private storage
            workspace with folders, previews, search, starring, trash, and secure phone login.
          </p>
          <div className="landing-actions">
            <Button type="button" className="primary" onClick={onGetStarted}>
              Connect Telegram
              <ChevronRight size={18} />
            </Button>
            <a href="#interface">See the interface</a>
          </div>
        </div>
      </section>

      <section className="interface-showcase" id="interface" aria-labelledby="interface-title">
        <div className="interface-copy">
          <p className="eyebrow">The drive experience</p>
          <h2 id="interface-title">A clean dashboard for everything you store.</h2>
          <p>
            Files open in rich previews, actions stay tucked into menus, and every view keeps the
            calm density of a professional Apple-style workspace.
          </p>
        </div>

        <div className="interface-frame" aria-hidden="true">
          <div className="interface-sidebar">
            <div className="scene-brand">
              <BrandMark className="tiny" />
              <span>GramDrive</span>
            </div>
            <span className="scene-nav active">Home</span>
            <span className="scene-nav">Recent</span>
            <span className="scene-nav">Starred</span>
            <span className="scene-nav">Trash</span>
            <div className="interface-user">
              <span>S</span>
              <div>
                <strong>Sandip</strong>
                <em>Connected</em>
              </div>
            </div>
          </div>

          <div className="interface-main">
            <div className="interface-topbar">
              <div>
                <span>Drive</span>
                <strong>Home</strong>
              </div>
              <div className="scene-toolbar">
                <span className="scene-search">
                  <Search size={14} />
                  Search files
                </span>
                <span className="scene-upload">
                  <Upload size={14} />
                  Upload
                </span>
              </div>
            </div>

            <div className="interface-crumbs">
              <Cloud size={15} />
              Telegram
              <ChevronRight size={14} />
              Home
            </div>

            <div className="interface-stats">
              <span>
                <strong>2</strong>
                Files
              </span>
              <span>
                <strong>8.0 MB</strong>
                Stored
              </span>
              <span>
                <strong>0</strong>
                Starred
              </span>
            </div>

            <div className="interface-files">
              <span className="interface-card">
                <FileImage size={32} />
                <strong>thumbnail.png</strong>
                <em>1.3 MB</em>
              </span>
              <span className="interface-card">
                <FileVideo size={32} />
                <strong>voiceover.mp4</strong>
                <em>6.7 MB</em>
              </span>
              <span className="interface-card ghost">
                <MoreHorizontal size={24} />
                <strong>Actions menu</strong>
                <em>Star, rename, trash</em>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-feature-band" id="experience" aria-label="Product highlights">
        {featureItems.map(({ icon: Icon, title, copy }) => (
          <article className="landing-feature" key={title}>
            <Icon size={20} />
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="landing-security" id="security">
        <div>
          <p className="eyebrow">Designed for trust</p>
          <h2>Your drive, your Telegram session.</h2>
        </div>
        <p>
          GramDrive keeps the onboarding clear: users paste their Telegram API credentials,
          verify their phone number, and then manage files in a web dashboard built for everyday use.
        </p>
        <Button type="button" className="primary" onClick={onGetStarted}>
          Go to Login
        </Button>
      </section>
    </main>
  );
}

function LoginView({
  config,
  onBack,
  onSignedIn
}: {
  config: AppConfig | null;
  onBack: () => void;
  onSignedIn: (user: PublicUser) => void;
}) {
  const [step, setStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loginId, setLoginId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await DriveApi.sendCode(phone, apiId, apiHash);
      setLoginId(result.loginId);
      setStep("code");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await DriveApi.verifyCode(loginId, code);

      if (result.requiresPassword) {
        setStep("password");
      } else {
        onSignedIn(result.user);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to verify code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await DriveApi.verifyPassword(loginId, password);
      onSignedIn(result.user);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to verify password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <nav className="auth-nav" aria-label="Authentication">
        <button className="landing-brand" type="button" onClick={onBack}>
          <BrandMark className="navicon" />
          <span>GramDrive</span>
        </button>
        <Button type="button" onClick={onBack}>
          Home
        </Button>
      </nav>
      <section className="login-pane" aria-labelledby="login-title">
        <div className="login-brand">
          <BrandMark />
          <div>
            <p className="eyebrow">API key and phone login</p>
            <h1 id="login-title">Connect your Telegram account.</h1>
          </div>
        </div>

        <div className="trust-row" aria-label="Privacy details">
          <span>
            <ShieldCheck size={16} />
            Encrypted credentials
          </span>
          <span>
            <Lock size={16} />
            Server-side MTProto
          </span>
        </div>

        {step === "phone" && (
          <form className="login-form" onSubmit={submitPhone}>
            <div className="credential-guide">
              <div className="guide-heading">
                <KeyRound size={18} />
                <strong>Telegram API credentials</strong>
              </div>
              <p>
                Get these from Telegram once, then paste them here to connect this drive to your
                own account.
              </p>
              <ol>
                <li>Open my.telegram.org/apps and sign in.</li>
                <li>Create an app if you do not already have one.</li>
                <li>Copy `api_id` and `api_hash` from the app details.</li>
              </ol>
              <a
                className="guide-link"
                href="https://my.telegram.org/apps"
                target="_blank"
                rel="noreferrer"
              >
                Open Telegram API page
                <ExternalLink size={15} />
              </a>
            </div>

            <div className="credential-grid">
              <label>
                API ID
                <input
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="123456"
                  value={apiId}
                  onChange={(event) => setApiId(event.target.value.replace(/\D/g, ""))}
                />
              </label>

              <label>
                API hash
                <input
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="32 character hash"
                  value={apiHash}
                  onChange={(event) => setApiHash(event.target.value.trim())}
                />
              </label>
            </div>

            <label>
              Phone number
              <input
                autoComplete="tel"
                inputMode="tel"
                placeholder="+14155552671"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <Button className="primary full" busy={busy} disabled={!apiId || !apiHash || !phone}>
              <ChevronRight size={18} />
              Continue
            </Button>
          </form>
        )}

        {step === "code" && (
          <form className="login-form" onSubmit={submitCode}>
            <label>
              Telegram code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="12345"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <Button className="primary full" busy={busy}>
              <CheckCircle2 size={18} />
              Verify
            </Button>
          </form>
        )}

        {step === "password" && (
          <form className="login-form" onSubmit={submitPassword}>
            <label>
              Two-step password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button className="primary full" busy={busy}>
              <Lock size={18} />
              Unlock
            </Button>
          </form>
        )}

        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}

const primaryViews: Array<{
  key: DriveViewKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { key: "home", label: "Home", icon: Home },
  { key: "recent", label: "Recent", icon: Clock3 },
  { key: "starred", label: "Starred", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 }
];

function formatDateTime(value?: string) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function folderName(folders: FolderRecord[], folderId: string) {
  return folders.find((folder) => folder.id === folderId)?.name ?? "Saved Messages";
}

function formatCompactNumber(value?: number) {
  if (!value) return "";

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function Sidebar({
  user,
  folders,
  channels,
  channelsLoading,
  channelsError,
  activeView,
  activeFolderId,
  storageSummary,
  drawerOpen,
  onViewChange,
  onFolderChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onClose,
  onLogout
}: {
  user: PublicUser;
  folders: FolderRecord[];
  channels: TelegramChannelRecord[];
  channelsLoading: boolean;
  channelsError: string;
  activeView: DriveViewKey;
  activeFolderId: string;
  storageSummary: StorageSummary;
  drawerOpen: boolean;
  onViewChange: (view: DriveViewKey) => void;
  onFolderChange: (folderId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");

  function submitFolder(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateFolder(trimmed);
    setName("");
    setCreating(false);
  }

  function startRename(folder: FolderRecord) {
    setEditingId(folder.id);
    setEditingName(folder.name);
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    const trimmed = editingName.trim();
    if (!editingId || !trimmed) return;
    onRenameFolder(editingId, trimmed);
    setEditingId("");
    setEditingName("");
  }

  return (
    <aside className={drawerOpen ? "sidebar drawer-open" : "sidebar"}>
      <div className="sidebar-brand">
        <BrandMark className="small" />
        <div>
          <strong>GramDrive</strong>
          <span>Telegram storage</span>
        </div>
        <IconButton className="drawer-close" label="Close navigation" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="storage-panel">
        <div className="storage-icon">
          <HardDrive size={18} />
        </div>
        <div>
          <strong>{formatBytes(storageSummary.totalSize)}</strong>
          <span>
            {storageSummary.totalFiles} files · {storageSummary.starredFiles} starred
          </span>
        </div>
      </div>

      <nav className="library-nav" aria-label="Library">
        {primaryViews.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={
              activeView === key && (key !== "folder" || activeFolderId === rootFolderId)
                ? "library-link active"
                : "library-link"
            }
            onClick={() => {
              if (key === "folder") {
                onFolderChange(rootFolderId);
              } else {
                onViewChange(key);
              }
              onClose();
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
            {key === "trash" && storageSummary.trashedFiles > 0 && (
              <em>{storageSummary.trashedFiles}</em>
            )}
          </button>
        ))}
      </nav>

      <nav className="channel-nav" aria-label="Created Telegram channels">
        <div className="nav-title">
          <span>Telegram Channels</span>
          {channelsLoading && <Loader2 className="spin" size={14} />}
        </div>

        {channelsError ? (
          <div className="channel-empty">{channelsError}</div>
        ) : channelsLoading && !channels.length ? (
          <div className="channel-empty">Fetching channels...</div>
        ) : channels.length ? (
          channels.map((channel) => {
            const meta = channel.username
              ? `@${channel.username}`
              : channel.isPrivate
                ? "Private channel"
                : "Channel";
            const participants = formatCompactNumber(channel.participantsCount);
            const content = (
              <>
                <RadioTower size={17} />
                <span>
                  <strong title={channel.title}>{channel.title}</strong>
                  <em title={meta}>{meta}</em>
                </span>
                {participants && <small>{participants}</small>}
              </>
            );

            return channel.username ? (
              <a
                className="channel-link"
                href={`https://t.me/${channel.username}`}
                key={channel.id}
                rel="noreferrer"
                target="_blank"
              >
                {content}
              </a>
            ) : (
              <div className="channel-link private" key={channel.id}>
                {content}
              </div>
            );
          })
        ) : (
          <div className="channel-empty">No created channels found.</div>
        )}
      </nav>

      <nav className="folder-nav" aria-label="Folders">
        <div className="nav-title">
          <span>Folders</span>
          <IconButton label="New folder" onClick={() => setCreating(true)}>
            <Plus size={16} />
          </IconButton>
        </div>

        {folders.filter((folder) => folder.id !== rootFolderId).map((folder) =>
          editingId === folder.id ? (
            <form className="folder-edit" key={folder.id} onSubmit={submitRename}>
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setEditingId("");
                    setEditingName("");
                  }
                }}
              />
              <IconButton
                label="Cancel rename"
                type="button"
                onClick={() => {
                  setEditingId("");
                  setEditingName("");
                }}
              >
                <X size={15} />
              </IconButton>
              <IconButton label="Save folder name" type="submit">
                <CheckCircle2 size={15} />
              </IconButton>
            </form>
          ) : (
            <div
              key={folder.id}
              className={
                activeView === "folder" && folder.id === activeFolderId
                  ? "folder-item active"
                  : "folder-item"
              }
            >
              <button
                className="folder-link"
                onClick={() => {
                  onFolderChange(folder.id);
                  onClose();
                }}
              >
                <Folder size={17} />
                <span>{folder.name}</span>
              </button>
              {folder.id !== rootFolderId && (
                <div className="folder-actions">
                  <IconButton label={`Rename ${folder.name}`} onClick={() => startRename(folder)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton label={`Delete ${folder.name}`} onClick={() => onDeleteFolder(folder.id)}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              )}
            </div>
          )
        )}
      </nav>

      {creating && (
        <form className="folder-create" onSubmit={submitFolder}>
          <input
            autoFocus
            placeholder="Folder name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="folder-create-actions">
            <IconButton label="Cancel" type="button" onClick={() => setCreating(false)}>
              <X size={15} />
            </IconButton>
            <IconButton label="Create folder" type="submit">
              <CheckCircle2 size={15} />
            </IconButton>
          </div>
        </form>
      )}

      <div className="user-chip">
        <div className="avatar">{user.initials}</div>
        <div>
          <strong>{user.displayName}</strong>
          <span>{user.phone}</span>
        </div>
        <IconButton label="Sign out" onClick={onLogout}>
          <LogOut size={16} />
        </IconButton>
      </div>
    </aside>
  );
}

function FolderActionsMenu({
  folder,
  onRename,
  onDelete
}: {
  folder: FolderRecord;
  onRename: (folder: FolderRecord) => void;
  onDelete: (folderId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;

    function closeMenu() {
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function runAction(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <div className="folder-card-actions" onClick={(event) => event.stopPropagation()}>
      <IconButton
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={menuOpen ? "active" : ""}
        label={`Actions for ${folder.name}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={17} />
      </IconButton>
      {menuOpen && (
        <div className="action-menu folder-action-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => runAction(() => onRename(folder))}>
            <Pencil size={16} />
            <span>Rename</span>
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => runAction(() => onDelete(folder.id))}
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

function FileGlyph({ file }: { file: DriveFileRecord }) {
  const kind = getFileKind(file);
  const Icon = fileIcons[kind];

  return (
    <div className={`file-glyph ${kind}`}>
      <Icon size={26} />
    </div>
  );
}

function FileThumb({ file }: { file: DriveFileRecord }) {
  const [failed, setFailed] = useState(false);
  const kind = getFileKind(file);
  const previewUrl = `/api/files/${file.id}/preview`;

  if (!failed && kind === "image") {
    return (
      <div className="file-thumb has-media">
        <img loading="lazy" src={previewUrl} alt="" onError={() => setFailed(true)} />
      </div>
    );
  }

  if (!failed && kind === "video") {
    return (
      <div className="file-thumb has-media">
        <video muted playsInline preload="metadata" src={previewUrl} onError={() => setFailed(true)} />
        <span className="thumb-badge">
          <FileVideo size={16} />
        </span>
      </div>
    );
  }

  return (
    <div className="file-thumb icon-only">
      <FileGlyph file={file} />
    </div>
  );
}

function FileActions({
  file,
  isTrash,
  onDetails,
  onToggleStar,
  onRename,
  onMoveToTrash,
  onRestore,
  onPermanentDelete,
  onOpen
}: {
  file: DriveFileRecord;
  isTrash: boolean;
  onDetails: (file: DriveFileRecord) => void;
  onToggleStar: (file: DriveFileRecord) => void;
  onRename: (file: DriveFileRecord) => void;
  onMoveToTrash: (file: DriveFileRecord) => void;
  onRestore: (file: DriveFileRecord) => void;
  onPermanentDelete: (file: DriveFileRecord) => void;
  onOpen: (file: DriveFileRecord) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;

    function closeMenu() {
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function runAction(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <div className="file-actions" onClick={(event) => event.stopPropagation()}>
      <IconButton
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={menuOpen ? "active" : ""}
        label={`Actions for ${file.name}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={17} />
      </IconButton>

      {menuOpen && (
        <div className="action-menu" role="menu">
          {isTrash ? (
            <>
              <button type="button" role="menuitem" onClick={() => runAction(() => onRestore(file))}>
                <RotateCcw size={16} />
                <span>Restore</span>
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => runAction(() => onPermanentDelete(file))}
              >
                <Trash2 size={16} />
                <span>Delete Permanently</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => runAction(() => onToggleStar(file))}>
                <Star size={16} fill={file.starred ? "currentColor" : "none"} />
                <span>{file.starred ? "Unstar" : "Star"}</span>
              </button>
              <a
                href={`/api/files/${file.id}/download`}
                role="menuitem"
                onClick={() => {
                  onOpen(file);
                  setMenuOpen(false);
                }}
              >
                <Download size={16} />
                <span>Download</span>
              </a>
              <button type="button" role="menuitem" onClick={() => runAction(() => onRename(file))}>
                <Pencil size={16} />
                <span>Rename</span>
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => runAction(() => onMoveToTrash(file))}
              >
                <Trash2 size={16} />
                <span>Move to Trash</span>
              </button>
            </>
          )}
          <button type="button" role="menuitem" onClick={() => runAction(() => onDetails(file))}>
            <Info size={16} />
            <span>Details</span>
          </button>
        </div>
      )}
    </div>
  );
}

function FileGrid({
  files,
  viewMode,
  folders,
  selectedFileId,
  isTrash,
  onDetails,
  onToggleStar,
  onRename,
  onMoveToTrash,
  onRestore,
  onPermanentDelete,
  onOpen,
  onPreview
}: {
  files: DriveFileRecord[];
  viewMode: ViewMode;
  folders: FolderRecord[];
  selectedFileId?: string;
  isTrash: boolean;
  onDetails: (file: DriveFileRecord) => void;
  onToggleStar: (file: DriveFileRecord) => void;
  onRename: (file: DriveFileRecord) => void;
  onMoveToTrash: (file: DriveFileRecord) => void;
  onRestore: (file: DriveFileRecord) => void;
  onPermanentDelete: (file: DriveFileRecord) => void;
  onOpen: (file: DriveFileRecord) => void;
  onPreview: (file: DriveFileRecord) => void;
}) {
  if (!files.length) {
    return (
      <div className="empty-state">
        <Archive size={34} />
        <h2>No files here yet</h2>
        <p>Upload a file and it will be stored in your Telegram Saved Messages.</p>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="file-list">
        {files.map((file) => (
          <article
            className={selectedFileId === file.id ? "file-row selected" : "file-row"}
            key={file.id}
            onClick={() => onPreview(file)}
          >
            <FileGlyph file={file} />
            <div className="file-main">
              <strong>{file.name}</strong>
              <span>{folderName(folders, file.folderId)}</span>
            </div>
            <span className="muted">{formatBytes(file.size)}</span>
            <span className="muted">{formatDate(file.updatedAt)}</span>
            <FileActions
              file={file}
              isTrash={isTrash}
              onDetails={onDetails}
              onToggleStar={onToggleStar}
              onRename={onRename}
              onMoveToTrash={onMoveToTrash}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onOpen={onOpen}
            />
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="file-grid">
      {files.map((file) => (
        <article
          className={selectedFileId === file.id ? "file-card selected" : "file-card"}
          key={file.id}
          onClick={() => onPreview(file)}
        >
          <div className="file-thumb-shell">
            <FileThumb file={file} />
            <FileActions
              file={file}
              isTrash={isTrash}
              onDetails={onDetails}
              onToggleStar={onToggleStar}
              onRename={onRename}
              onMoveToTrash={onMoveToTrash}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onOpen={onOpen}
            />
          </div>
          <strong title={file.name}>
            {file.starred && <Star size={14} fill="currentColor" />}
            <span>{file.name}</span>
          </strong>
          <div className="file-meta">
            <span>{formatBytes(file.size)}</span>
            <span>{formatDate(file.updatedAt)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function DetailsModal({
  file,
  folders,
  isTrash,
  onClose,
  onRename,
  onMove,
  onToggleStar,
  onRestore,
  onMoveToTrash,
  onPermanentDelete
}: {
  file: DriveFileRecord;
  folders: FolderRecord[];
  isTrash: boolean;
  onClose: () => void;
  onRename: (file: DriveFileRecord) => void;
  onMove: (file: DriveFileRecord, folderId: string) => void;
  onToggleStar: (file: DriveFileRecord) => void;
  onRestore: (file: DriveFileRecord) => void;
  onMoveToTrash: (file: DriveFileRecord) => void;
  onPermanentDelete: (file: DriveFileRecord) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="details-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={`Details for ${file.name}`}
        aria-modal="true"
        className="details-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="details-header">
          <FileGlyph file={file} />
          <IconButton label="Close details" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="details-title">
          <strong>{file.name}</strong>
          <span>{file.mimeType || "application/octet-stream"}</span>
        </div>

        <div className="details-actions">
          {isTrash ? (
            <>
              <Button onClick={() => onRestore(file)}>
                <RotateCcw size={16} />
                Restore
              </Button>
              <Button onClick={() => onPermanentDelete(file)}>
                <Trash2 size={16} />
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => onToggleStar(file)}>
                <Star size={16} fill={file.starred ? "currentColor" : "none"} />
                {file.starred ? "Starred" : "Star"}
              </Button>
              <Button onClick={() => onRename(file)}>
                <Pencil size={16} />
                Rename
              </Button>
            </>
          )}
        </div>

        {!isTrash && (
          <label className="move-control">
            Move to
            <select value={file.folderId} onChange={(event) => onMove(file, event.target.value)}>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <dl className="details-list">
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(file.size)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{folderName(folders, file.folderId)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(file.createdAt)}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatDateTime(file.updatedAt)}</dd>
          </div>
          <div>
            <dt>Last opened</dt>
            <dd>{formatDateTime(file.lastOpenedAt)}</dd>
          </div>
        </dl>

        {!isTrash && (
          <Button className="subtle-danger" onClick={() => onMoveToTrash(file)}>
            <Trash2 size={16} />
            Move to Trash
          </Button>
        )}

      </section>
    </div>
  );
}

function DriveView({
  user,
  onLogout
}: {
  user: PublicUser;
  onLogout: () => void;
}) {
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [channels, setChannels] = useState<TelegramChannelRecord[]>([]);
  const [files, setFiles] = useState<DriveFileRecord[]>([]);
  const [activeView, setActiveView] = useState<DriveViewKey>("home");
  const [activeFolderId, setActiveFolderId] = useState(rootFolderId);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [galleryQueue, setGalleryQueue] = useState<GalleryQueueItem[]>([]);
  const [galleryStatus, setGalleryStatus] = useState("");
  const [gallerySyncing, setGallerySyncing] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [previewFile, setPreviewFile] = useState<PreviewFile>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [storageSummary, setStorageSummary] = useState<StorageSummary>({
    totalFiles: 0,
    totalSize: 0,
    trashedFiles: 0,
    starredFiles: 0
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const gallerySyncingRef = useRef(false);

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);
  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;
  const isTrashView = activeView === "trash";
  const visibleSummary = {
    totalFiles: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    starredFiles: files.filter((file) => file.starred).length,
    trashedFiles: isTrashView ? files.length : 0
  };
  const title =
    activeView === "folder"
      ? activeFolder?.name ?? "Saved Messages"
      : {
          home: "Home",
          recent: "Recent",
          starred: "Starred",
          trash: "Trash"
        }[activeView];
  const mobileFolders = folders.filter((folder) => folder.id !== rootFolderId);
  const showMobileFolders =
    activeView === "home" || (activeView === "folder" && activeFolderId === rootFolderId);
  const mobileTitle = showMobileFolders ? "My Drive" : title;
  const galleryStatusLabel = gallerySyncing
    ? "Syncing gallery"
    : galleryStatus || (galleryQueue.length ? `${galleryQueue.length} queued` : "Photos and videos");

  async function refreshFolders() {
    const response = await DriveApi.folders();
    setFolders(response.folders);
  }

  async function refreshChannels() {
    setChannelsLoading(true);
    setChannelsError("");

    try {
      const response = await DriveApi.createdChannels();
      setChannels(response.channels);
    } catch (nextError) {
      setChannelsError(nextError instanceof Error ? nextError.message : "Unable to fetch channels.");
    } finally {
      setChannelsLoading(false);
    }
  }

  async function refreshStorageSummary() {
    setStorageSummary(await DriveApi.storageSummary());
  }

  async function refreshDashboard() {
    await Promise.all([refreshFiles(), refreshStorageSummary()]);
  }

  async function refreshFiles() {
    setLoadingFiles(true);
    setError("");

    try {
      const response = await DriveApi.files({
        view: activeView,
        folderId: activeFolderId,
        search,
        sort: sortKey,
        direction: sortDirection
      });
      setFiles(response.files);
      if (selectedFileId && !response.files.some((file) => file.id === selectedFileId)) {
        setSelectedFileId("");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load files.");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function refreshGalleryQueue() {
    const nextQueue = await listGalleryQueue();
    setGalleryQueue(nextQueue);
    return nextQueue;
  }

  useEffect(() => {
    refreshFolders().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load folders.");
    });
    refreshStorageSummary().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load storage summary.");
    });
    refreshChannels().catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshGalleryQueue()
      .then((queue) => {
        if (queue.length && navigator.onLine) {
          processGalleryQueue();
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [activeView, activeFolderId, search, sortKey, sortDirection]);

  useEffect(() => {
    if (!sidebarOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    function handleOnline() {
      processGalleryQueue();
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [activeView, activeFolderId, search, sortKey, sortDirection]);

  function changeView(view: DriveViewKey) {
    setActiveView(view);
    setSelectedFileId("");
  }

  function changeFolder(folderId: string) {
    setActiveView("folder");
    setActiveFolderId(folderId);
    setSelectedFileId("");
  }

  function renameFolderFromModal(folder: FolderRecord) {
    setRenameTarget({
      kind: "folder",
      id: folder.id,
      name: folder.name
    });
  }

  function createFolderFromModal() {
    setRenameTarget({
      kind: "new-folder",
      id: "",
      name: ""
    });
  }

  async function runConfirmAction() {
    if (!confirmDialog) return;

    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function createFolder(name: string) {
    try {
      const response = await DriveApi.createFolder(name);
      setFolders((current) => [...current, response.folder]);
      changeFolder(response.folder.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create folder.");
    }
  }

  async function renameFolder(folderId: string, name: string) {
    try {
      const response = await DriveApi.renameFolder(folderId, name);
      setFolders((current) =>
        current.map((folder) => (folder.id === folderId ? response.folder : folder))
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to rename folder.");
    }
  }

  function deleteFolder(folderId: string) {
    const folder = folders.find((item) => item.id === folderId);
    const folderName = folder?.name ?? "this folder";

    setConfirmDialog({
      title: "Delete folder?",
      message: `${folderName} will be removed. Files inside it will move back to Saved Messages.`,
      confirmLabel: "Delete Folder",
      destructive: true,
      onConfirm: async () => {
        try {
          await DriveApi.deleteFolder(folderId);
          setFolders((current) => current.filter((item) => item.id !== folderId));
          if (activeFolderId === folderId) {
            changeFolder(rootFolderId);
          }
          await refreshDashboard();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Unable to delete folder.");
        }
      }
    });
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList);
    const targetFolderId = activeView === "folder" ? activeFolderId : rootFolderId;

    for (const file of nextFiles) {
      setUploadState({ name: file.name, progress: 0 });
      setError("");

      try {
        await uploadDriveFile(file, targetFolderId, (progress) => {
          setUploadState({ name: file.name, progress });
        });
        await refreshDashboard();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : `Unable to upload ${file.name}.`);
      } finally {
        setUploadState(null);
      }
    }
  }

  async function queueGallerySelection(fileList: FileList | File[]) {
    const selectedFiles = Array.from(fileList).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );

    if (!selectedFiles.length) {
      setGalleryStatus("No media selected");
      return;
    }

    if (!("indexedDB" in window)) {
      setError("Gallery sync queue is not available in this browser.");
      return;
    }

    const targetFolderId = activeView === "folder" ? activeFolderId : rootFolderId;
    setError("");

    try {
      if (navigator.storage?.persist) {
        navigator.storage.persist().catch(() => undefined);
      }

      await queueGalleryFiles(selectedFiles, targetFolderId);
      const queue = await refreshGalleryQueue();
      setGalleryStatus(`${queue.length} queued`);

      if (navigator.onLine) {
        processGalleryQueue();
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to queue gallery media for sync."
      );
    }
  }

  async function processGalleryQueue() {
    if (gallerySyncingRef.current) return;

    if (!navigator.onLine) {
      const queue = await refreshGalleryQueue().catch(() => galleryQueue);
      if (queue.length) {
        setGalleryStatus(`${queue.length} waiting for connection`);
      }
      return;
    }

    gallerySyncingRef.current = true;
    setGallerySyncing(true);
    setError("");

    try {
      let queue = await refreshGalleryQueue();
      if (!queue.length) {
        setGalleryStatus("");
        return;
      }

      for (const item of queue) {
        const queuedItem = await readGalleryQueueItem(item.id);
        if (!queuedItem) continue;

        setGalleryStatus(`Uploading ${item.name}`);
        setUploadState({ name: item.name, progress: 0 });

        await uploadDriveFile(queuedItem.file, queuedItem.folderId, (progress) => {
          setUploadState({ name: item.name, progress });
        });

        await deleteGalleryQueueItem(item.id);
        queue = await refreshGalleryQueue();
      }

      setGalleryStatus("Gallery sync complete");
      await refreshDashboard();
    } catch (nextError) {
      const queue = await refreshGalleryQueue().catch(() => galleryQueue);
      setGalleryStatus(queue.length ? `${queue.length} queued` : "Gallery sync paused");
      setError(
        navigator.onLine
          ? nextError instanceof Error
            ? nextError.message
            : "Gallery sync paused. Open GramDrive again to resume."
          : "Gallery sync paused until your connection returns."
      );
    } finally {
      gallerySyncingRef.current = false;
      setGallerySyncing(false);
      setUploadState(null);
    }
  }

  function renameFile(file: DriveFileRecord) {
    setRenameTarget({
      kind: "file",
      id: file.id,
      name: file.name
    });
  }

  async function submitRename(name: string) {
    if (!renameTarget) return;

    setRenameBusy(true);
    try {
      if (renameTarget.kind === "file") {
        await DriveApi.updateFile(renameTarget.id, { name });
      } else if (renameTarget.kind === "folder") {
        await renameFolder(renameTarget.id, name);
      } else {
        await createFolder(name);
      }
      setRenameTarget(null);
      await refreshDashboard();
    } catch (nextError) {
      const action = renameTarget.kind === "new-folder" ? "create folder" : `rename ${renameTarget.kind}`;
      setError(
        nextError instanceof Error ? nextError.message : `Unable to ${action}.`
      );
    } finally {
      setRenameBusy(false);
    }
  }

  async function moveFile(file: DriveFileRecord, folderId: string) {
    if (folderId === file.folderId) return;

    try {
      await DriveApi.updateFile(file.id, { folderId });
      await refreshDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to move file.");
    }
  }

  async function toggleStar(file: DriveFileRecord) {
    try {
      await DriveApi.updateFile(file.id, { starred: !file.starred });
      await refreshDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update star.");
    }
  }

  function moveFileToTrash(file: DriveFileRecord) {
    setConfirmDialog({
      title: "Move to Trash?",
      message: `${file.name} will leave this view and stay recoverable from Trash.`,
      confirmLabel: "Move to Trash",
      destructive: true,
      onConfirm: async () => {
        try {
          await DriveApi.deleteFile(file.id);
          setSelectedFileId("");
          await refreshDashboard();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Unable to move file to Trash.");
        }
      }
    });
  }

  async function restoreFile(file: DriveFileRecord) {
    try {
      await DriveApi.restoreFile(file.id);
      setSelectedFileId("");
      await refreshDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to restore file.");
    }
  }

  function permanentlyDeleteFile(file: DriveFileRecord) {
    setConfirmDialog({
      title: "Delete permanently?",
      message: `${file.name} will be removed from Telegram. This action cannot be undone.`,
      confirmLabel: "Delete Permanently",
      destructive: true,
      onConfirm: async () => {
        try {
          await DriveApi.permanentlyDeleteFile(file.id);
          setSelectedFileId("");
          await refreshDashboard();
        } catch (nextError) {
          setError(
            nextError instanceof Error ? nextError.message : "Unable to permanently delete file."
          );
        }
      }
    });
  }

  function markFileOpened(file: DriveFileRecord) {
    DriveApi.markFileOpened(file.id)
      .catch(() => null);
  }

  const shellClass = dragging ? "drive-shell dragging" : "drive-shell";

  return (
    <main
      className={shellClass}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) {
          uploadFiles(event.dataTransfer.files);
        }
      }}
    >
      <Sidebar
        user={user}
        folders={folders}
        channels={channels}
        channelsLoading={channelsLoading}
        channelsError={channelsError}
        activeView={activeView}
        activeFolderId={activeFolderId}
        storageSummary={storageSummary}
        drawerOpen={sidebarOpen}
        onViewChange={changeView}
        onFolderChange={changeFolder}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onClose={() => setSidebarOpen(false)}
        onLogout={onLogout}
      />

      <button
        aria-label="Close navigation"
        className={sidebarOpen ? "drawer-scrim visible" : "drawer-scrim"}
        onClick={() => setSidebarOpen(false)}
      />

      <section className="content">
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={galleryInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(event) => {
            if (event.target.files) queueGallerySelection(event.target.files);
            event.target.value = "";
          }}
        />

        <header className="mobile-drive-bar">
          <IconButton label="Open navigation" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </IconButton>
          <strong title={mobileTitle}>{mobileTitle}</strong>
          <IconButton
            className={mobileSearchOpen || search ? "active" : ""}
            label={mobileSearchOpen ? "Hide search" : "Search files"}
            onClick={() => setMobileSearchOpen((open) => !open)}
          >
            <Search size={20} />
          </IconButton>
          <IconButton
            label={viewMode === "grid" ? "List view" : "Grid view"}
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
          >
            {viewMode === "grid" ? <List size={20} /> : <Grid3X3 size={20} />}
          </IconButton>
        </header>

        <div className={mobileSearchOpen || search ? "mobile-search-panel open" : "mobile-search-panel"}>
          <label className="search-box">
            <Search size={17} />
            <input
              placeholder="Search files"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <header className="topbar desktop-topbar">
          <div>
            <p className="eyebrow">Drive</p>
            <h1>{title}</h1>
          </div>

          <div className="toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                placeholder="Search files"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <div className="segmented" aria-label="View mode">
              <button
                aria-label="Grid view"
                title="Grid view"
                className={viewMode === "grid" ? "selected" : ""}
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 size={16} />
              </button>
              <button
                aria-label="List view"
                title="List view"
                className={viewMode === "list" ? "selected" : ""}
                onClick={() => setViewMode("list")}
              >
                <List size={16} />
              </button>
            </div>

            <select
              className="sort-select"
              aria-label="Sort files"
              value={`${sortKey}:${sortDirection}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":") as [
                  FileSortKey,
                  "asc" | "desc"
                ];
                setSortKey(nextSort);
                setSortDirection(nextDirection);
              }}
            >
              <option value="updatedAt:desc">Modified</option>
              <option value="createdAt:desc">Newest</option>
              <option value="name:asc">Name</option>
              <option value="size:desc">Size</option>
            </select>

            <Button className="primary" onClick={() => inputRef.current?.click()}>
              <Upload size={17} />
              Upload
            </Button>
          </div>
        </header>

        <section className="mobile-section mobile-sync-section" aria-label="Gallery sync">
          <div className={gallerySyncing ? "gallery-sync-card syncing" : "gallery-sync-card"}>
            <div className="gallery-sync-icon">
              <Images size={19} />
            </div>
            <div className="gallery-sync-copy">
              <strong>Gallery sync</strong>
              <span title={galleryStatusLabel}>{galleryStatusLabel}</span>
            </div>
            <Button
              type="button"
              busy={gallerySyncing}
              className={galleryQueue.length ? "primary gallery-sync-action" : "gallery-sync-action"}
              onClick={() => {
                if (galleryQueue.length) {
                  processGalleryQueue();
                } else {
                  galleryInputRef.current?.click();
                }
              }}
            >
              {galleryQueue.length ? "Resume" : "Select"}
            </Button>
          </div>
        </section>

        {showMobileFolders && (
          <section className="mobile-section mobile-folders-section" aria-label="Folders">
            <div className="mobile-section-header">
              <h2>Folders</h2>
              <IconButton label="New folder" onClick={createFolderFromModal}>
                <Plus size={18} />
              </IconButton>
            </div>
            <div className="mobile-folder-grid">
              {mobileFolders.map((folder) => (
                <article className="mobile-folder-card" key={folder.id}>
                  <button className="mobile-folder-open" onClick={() => changeFolder(folder.id)}>
                    <Folder size={21} />
                    <span title={folder.name}>{folder.name}</span>
                  </button>
                  <FolderActionsMenu
                    folder={folder}
                    onRename={renameFolderFromModal}
                    onDelete={deleteFolder}
                  />
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="crumbs">
          <Cloud size={15} />
          <span>Telegram</span>
          <ChevronRight size={14} />
          <span>{title}</span>
          {activeView === "folder" && activeFolderId !== rootFolderId ? (
            <div className="crumb-actions">
              <IconButton
                label={`Rename ${activeFolder?.name ?? "folder"}`}
                onClick={() => {
                  if (activeFolder) renameFolderFromModal(activeFolder);
                }}
              >
                <Pencil size={16} />
              </IconButton>
              <IconButton
                label={`Delete ${activeFolder?.name ?? "folder"}`}
                onClick={() => deleteFolder(activeFolderId)}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          ) : (
            null
          )}
        </div>

        <div className="insight-strip">
          <div>
            <strong>{visibleSummary.totalFiles}</strong>
            <span>{activeView === "folder" ? "In folder" : "Files"}</span>
          </div>
          <div>
            <strong>{formatBytes(visibleSummary.totalSize)}</strong>
            <span>Stored</span>
          </div>
          <div>
            <strong>{visibleSummary.starredFiles}</strong>
            <span>Starred</span>
          </div>
          <div>
            <strong>{visibleSummary.trashedFiles}</strong>
            <span>Trash</span>
          </div>
        </div>

        {error && <div className="inline-error">{error}</div>}

        {uploadState && (
          <div className="upload-progress" role="status">
            <div>
              <Upload size={17} />
              <strong>{uploadState.name}</strong>
            </div>
            <progress value={uploadState.progress} max={100} />
            <span>{uploadState.progress}%</span>
          </div>
        )}

        <div className="mobile-section-header mobile-files-header">
          <h2>Files</h2>
          <select
            className="sort-select"
            aria-label="Sort files"
            value={`${sortKey}:${sortDirection}`}
            onChange={(event) => {
              const [nextSort, nextDirection] = event.target.value.split(":") as [
                FileSortKey,
                "asc" | "desc"
              ];
              setSortKey(nextSort);
              setSortDirection(nextDirection);
            }}
          >
            <option value="updatedAt:desc">Modified</option>
            <option value="createdAt:desc">Newest</option>
            <option value="name:asc">Name</option>
            <option value="size:desc">Size</option>
          </select>
        </div>

        <div className={loadingFiles ? "files-wrap loading" : "files-wrap"}>
          {loadingFiles ? (
            <div className="loading-state">
              <Loader2 className="spin" size={28} />
            </div>
          ) : (
            <FileGrid
              files={files}
              viewMode={viewMode}
              folders={folders}
              selectedFileId={selectedFileId}
              isTrash={isTrashView}
              onDetails={(file) => setSelectedFileId(file.id)}
              onToggleStar={toggleStar}
              onRename={renameFile}
              onMoveToTrash={moveFileToTrash}
              onRestore={restoreFile}
              onPermanentDelete={permanentlyDeleteFile}
              onOpen={markFileOpened}
              onPreview={(file) => {
                setPreviewFile(file);
                markFileOpened(file);
              }}
            />
          )}
        </div>
      </section>

      {selectedFile && (
        <DetailsModal
          file={selectedFile}
          folders={folders}
          isTrash={isTrashView}
          onClose={() => setSelectedFileId("")}
          onRename={renameFile}
          onMove={moveFile}
          onToggleStar={toggleStar}
          onRestore={restoreFile}
          onMoveToTrash={moveFileToTrash}
          onPermanentDelete={permanentlyDeleteFile}
        />
      )}

      <PreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onDetails={(file) => {
          setPreviewFile(null);
          setSelectedFileId(file.id);
        }}
      />

      {dragging && (
        <div className="drop-overlay">
          <Upload size={32} />
          <strong>Drop to upload</strong>
        </div>
      )}

      <Button
        aria-label="Upload files"
        className="primary mobile-upload-fab"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={21} />
      </Button>

      <ConfirmDialog
        dialog={confirmDialog}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) {
            setConfirmDialog(null);
          }
        }}
        onConfirm={runConfirmAction}
      />

      <RenameDialog
        file={renameTarget}
        busy={renameBusy}
        onCancel={() => {
          if (!renameBusy) {
            setRenameTarget(null);
          }
        }}
        onSubmit={submitRename}
      />
    </main>
  );
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authStarted, setAuthStarted] = useState(false);
  const [loading, setLoading] = useState(true);

  const appReady = useMemo(() => Boolean(config), [config]);

  useEffect(() => {
    Promise.all([DriveApi.config(), DriveApi.me()])
      .then(([nextConfig, auth]) => {
        setConfig(nextConfig);
        setUser(auth.user);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await DriveApi.logout();
    setUser(null);
    setAuthStarted(false);
  }

  if (loading || !appReady) {
    return (
      <main className="splash">
        <BrandMark className="small" />
        <Loader2 className="spin" size={22} />
      </main>
    );
  }

  if (!user) {
    if (!authStarted) {
      return <LandingView onGetStarted={() => setAuthStarted(true)} />;
    }

    return (
      <LoginView
        config={config}
        onBack={() => setAuthStarted(false)}
        onSignedIn={(nextUser) => {
          setUser(nextUser);
          setAuthStarted(false);
        }}
      />
    );
  }

  return <DriveView user={user} onLogout={logout} />;
}
