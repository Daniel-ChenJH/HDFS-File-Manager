export function fileExtension(name: string): string {
  const basename = name.split("/").pop() || name;
  const dot = basename.lastIndexOf(".");
  return dot > 0 && basename.length - dot <= 16 ? basename.slice(dot) : "";
}

export function fileKind(name: string, type = "FILE") {
  if (type === "DIRECTORY") return "folder";
  if (type === "SYMLINK") return "symlink";
  const ext = fileExtension(name).slice(1).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["json", "jsonl", "ndjson"].includes(ext)) return "json";
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "svg",
      "tif",
      "tiff",
      "ico",
    ].includes(ext)
  )
    return "image";
  if (["csv", "tsv", "xls", "xlsx", "ods"].includes(ext)) return "table";
  if (
    ["zip", "gz", "bz2", "xz", "tar", "tgz", "7z", "rar", "zst"].includes(ext)
  )
    return "archive";
  if (["parquet", "orc", "avro", "db", "sqlite"].includes(ext))
    return "database";
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "scala",
      "go",
      "rs",
      "c",
      "cpp",
      "h",
      "sh",
      "sql",
      "html",
      "css",
      "xml",
      "yaml",
      "yml",
      "toml",
    ].includes(ext)
  )
    return "code";
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) return "audio";
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return "video";
  if (
    [
      "txt",
      "log",
      "md",
      "rst",
      "ini",
      "conf",
      "properties",
      "doc",
      "docx",
      "odt",
      "rtf",
    ].includes(ext)
  )
    return "text";
  return "file";
}

export const themeIcons = {
  folder: "folder",
  symlink: "file-symlink-file",
  pdf: "file-pdf",
  json: "json",
  image: "file-media",
  table: "table",
  archive: "file-zip",
  database: "database",
  code: "file-code",
  audio: "file-media",
  video: "file-media",
  text: "file-text",
  file: "file",
};
