import { Client } from "./client";
import { HdfsError, Preferences } from "./model";
import { decodeText } from "./text-encoding";

export async function readPreview(
  client: Client,
  path: string,
  preferences: Preferences,
  signal: AbortSignal,
  encoding: unknown = "auto",
) {
  const stat = await client.stat(path, signal);
  if (stat.type !== "FILE") throw new HdfsError("path");
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const images: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  };
  const kind = ext === "pdf" ? "pdf" : images[ext] ? "image" : "text";
  const limit =
    kind === "text" ? preferences.textLimit : preferences.mediaLimit;
  const metadata = { size: stat.length, limit };
  if (kind !== "text" && stat.length > limit)
    return { type: "limited", ...metadata };
  const data = await client.read(path, limit, signal);
  if (signal.aborted) throw new HdfsError("cancelled");
  if (kind !== "text" && data.length !== stat.length)
    throw new HdfsError("changed");
  let text = "";
  let textMetadata = {};
  if (kind === "text") {
    const decoded = decodeText(data, encoding, stat.length > data.length);
    textMetadata = {
      encoding: decoded.encoding,
      automaticEncoding: decoded.automaticEncoding,
      encodingSelection: decoded.selection,
    };
    if (decoded.type !== "text")
      return { type: decoded.type, ...metadata, ...textMetadata };
    text = decoded.text;
  }
  return {
    type: "content",
    ...metadata,
    kind,
    ...textMetadata,
    mime: images[ext],
    data: kind === "text" ? text : data.toString("base64"),
    bytesRead: data.length,
    truncated: stat.length > data.length,
  };
}
