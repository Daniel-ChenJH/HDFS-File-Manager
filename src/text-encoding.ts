export const textEncodings = [
  "auto",
  "utf-8",
  "utf-16le",
  "utf-16be",
  "gbk",
  "ascii",
  "iso-8859-1",
] as const;
export type TextEncoding = (typeof textEncodings)[number];
export const normalizeEncoding = (value: unknown): TextEncoding =>
  textEncodings.includes(value as TextEncoding)
    ? (value as TextEncoding)
    : "auto";

export function decodeText(
  data: Buffer,
  requested: unknown,
  truncated: boolean,
) {
  const selection = normalizeEncoding(requested);
  const automaticEncoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const encoding = selection === "auto" ? automaticEncoding : selection;
  try {
    // WHATWG aliases ASCII and ISO-8859-1 to Windows-1252. Decode these two
    // explicitly so the selected encoding keeps its actual byte semantics.
    if (encoding === "ascii" && data.some((byte) => byte > 0x7f))
      throw new Error("ascii");
    const text =
      encoding === "iso-8859-1" || encoding === "ascii"
        ? data.toString("latin1")
        : new TextDecoder(encoding, { fatal: true }).decode(data, {
            stream: truncated,
          });
    const control = /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 8192));
    if (control) {
      // BOM-less UTF-16 is selectable, but never guessed as a successful read.
      const sample = data.subarray(0, 2048);
      let even = 0,
        odd = 0;
      sample.forEach((byte, i) => {
        if (!byte) i % 2 ? odd++ : even++;
      });
      const pairs = Math.max(1, Math.floor(sample.length / 2));
      const likelyUtf16 =
        Math.max(even, odd) / pairs > 0.3 && Math.min(even, odd) / pairs < 0.1;
      return {
        type:
          selection !== "auto" || likelyUtf16
            ? ("encoding" as const)
            : ("binary" as const),
        encoding,
        selection,
        automaticEncoding,
      };
    }
    return {
      type: "text" as const,
      text,
      encoding,
      selection,
      automaticEncoding,
    };
  } catch {
    return {
      type: "encoding" as const,
      encoding,
      selection,
      automaticEncoding,
    };
  }
}
