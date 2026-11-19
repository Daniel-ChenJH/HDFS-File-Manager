import { Entry } from "./model";

const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const pageSizes = [10, 20, 50, 100, 200];
export const normalizePageSize = (value: unknown): number =>
  pageSizes.includes(Number(value)) ? Number(value) : 50;
export function selectPage(
  entries: Entry[],
  filter: string,
  page: number,
  sort = "name",
  descending = false,
  requestedSize: unknown = 50,
  focusName?: string,
) {
  const pageSize = normalizePageSize(requestedSize);
  const needle = filter.toLocaleLowerCase();
  const items = entries.filter((entry) =>
    entry.pathSuffix.toLocaleLowerCase().includes(needle),
  );
  items.sort((a, b) => {
    const directory =
      Number(b.type === "DIRECTORY") - Number(a.type === "DIRECTORY");
    const order =
      sort === "size"
        ? a.length - b.length
        : sort === "modified"
          ? a.modificationTime - b.modificationTime
          : names.compare(a.pathSuffix, b.pathSuffix);
    return (
      directory ||
      (descending ? -order : order) ||
      names.compare(a.pathSuffix, b.pathSuffix)
    );
  });
  const last = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  page = Number.isFinite(page)
    ? Math.max(0, Math.min(Math.floor(page), last))
    : 0;
  const focusIndex = focusName
    ? items.findIndex((entry) => entry.pathSuffix === focusName)
    : -1;
  if (focusIndex >= 0) page = Math.floor(focusIndex / pageSize);
  return {
    items: items.slice(page * pageSize, page * pageSize + pageSize),
    count: items.length,
    total: entries.length,
    page,
    pageSize,
    ...(focusName ? { focusFound: focusIndex >= 0 } : {}),
  };
}
