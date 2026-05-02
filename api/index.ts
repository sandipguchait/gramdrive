import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/server/index.js";

type MutableRequest = IncomingMessage & {
  url?: string;
};

export default function handler(req: MutableRequest, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? "/", "https://gramdrive.local");
  const path = requestUrl.searchParams.get("path") ?? "";

  requestUrl.searchParams.delete("path");

  const search = requestUrl.searchParams.toString();
  req.url = `/api/${path}${search ? `?${search}` : ""}`;

  return app(req, res);
}
