# GramDrive

A web version of a Telegram-backed cloud drive. Users sign in with their Telegram phone number, then upload, browse, download, and delete files stored in their own Telegram Saved Messages.

The app uses an Apple-inspired interface with system fonts, glassy sidebars, segmented controls, compact file cards, and icon-first controls.

## Important Deployment Note

This cannot be deployed as a purely static website. Telegram phone login and MTProto sessions must be handled on a backend so API credentials and user sessions are not exposed in the browser.

Good deployment targets:

- Fly.io
- Railway
- Render
- A VPS
- Any persistent Node.js host with disk or mounted volume storage

Avoid static-only hosts for the full app:

- GitHub Pages
- Netlify static only
- Vercel static only

### Vercel

The repo includes `vercel.json` and an `api/index.ts` entry so Vercel can serve the
React app from `dist/client` and forward `/api/*` requests to the Node backend.

Set these Vercel environment variables before deploying:

```bash
APP_SECRET=replace_with_a_32_plus_character_random_secret
MAX_UPLOAD_MB=100
```

Vercel serverless storage is temporary. The app will boot on Vercel, but metadata stored in
`DATA_DIR` can disappear between deployments or cold starts unless you move the store to a
database or persistent storage service. For production users, prefer a persistent Node host or
replace the JSON store with Postgres/SQLite on durable storage.

## Telegram API Credentials

Users paste their own Telegram API credentials on the login screen. The screen includes a short guide and a link to [my.telegram.org/apps](https://my.telegram.org/apps).

For each user:

1. Open [my.telegram.org/apps](https://my.telegram.org/apps).
2. Sign in with the Telegram phone number.
3. Create an app if one does not already exist.
4. Copy `api_id` and `api_hash`.
5. Paste them into the login form with the phone number.

The API hash is stored encrypted with `APP_SECRET` after login so uploads and downloads keep working across sessions.

## Server Setup

Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

Set:

```bash
APP_SECRET=replace_with_a_32_plus_character_random_secret
PORT=4173
DATA_DIR=./data
MAX_UPLOAD_MB=100
```

`APP_SECRET` encrypts stored Telegram session strings and user API hashes. Use a long random value before deploying.

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:4173
```

The dev command runs one Express server and mounts Vite in middleware mode, so the web UI and API share the same port.

## Production Build

```bash
npm run build
npm start
```

The production server serves the built React client from `dist/client` and all API routes from the same origin.

## Current Storage Model

Files are uploaded as Telegram documents to the signed-in user's Saved Messages. Metadata and encrypted login material are stored in `DATA_DIR/store.json` so the app can show folder organization and file lists quickly.

For a larger public launch, replace the JSON store with Postgres or SQLite on a persistent volume. The Telegram file bytes remain in the user's Telegram account.

## Premium Drive Features

The app now includes a professional drive layer inspired by iCloud Drive and Google Drive:

- Home, My Drive, Recent, Starred, and Trash views
- File starring
- Soft delete to Trash
- Restore from Trash
- Permanent delete from Telegram
- File rename
- File move between folders
- Folder create, rename, and delete
- Global storage summary
- Sort by modified date, creation date, name, or size
- Details panel with file metadata
- Activity feed for file and folder operations

## Security Checklist Before Public Launch

- Use HTTPS.
- Set a strong `APP_SECRET`.
- Run on a backend host, not a static-only host.
- Put `DATA_DIR` on persistent private storage.
- Add database backups if you move from JSON to SQL.
- Add rate limiting in front of `/api/auth/send-code`.
- Explain why users must provide their own Telegram `api_id` and `api_hash`.
- Publish clear user-facing privacy terms explaining that the app acts as a Telegram client.
