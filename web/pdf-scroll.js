import { element as el } from "./strings.js";

// Keep page positions in the document, but only retain nearby canvas pixels.
const retainedPages = 6;

export function createPdfScroller(app, pdf, s) {
  let stopped = false,
    pumping = false,
    frame = 0,
    width = 0,
    observer,
    resizeObserver,
    wanted = [],
    pages = [];
  const nearby = new Set();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const pageInput = el("input", {
    type: "number",
    min: 1,
    max: pdf.numPages,
    value: 1,
    "aria-label": s.goPage,
  });
  const controls = el(
    "form",
    {
      class: "pdf-controls",
      onsubmit: (event) => {
        event.preventDefault();
        const page = pages[Number(pageInput.value) - 1];
        if (page) {
          viewport.scrollTop = page.node.offsetTop;
          viewport.focus({ preventScroll: true });
        }
      },
    },
    pageInput,
    el("span", {}, `/ ${pdf.numPages}`),
  );
  const stack = el("div", { class: "pdf-pages" });
  const viewport = el(
    "div",
    { class: "pdf-scroll", tabindex: 0, "aria-label": s.preview },
    stack,
  );
  app.classList.add("pdf-preview");
  app.append(controls, viewport);

  function recycle(page) {
    page.version++;
    page.render?.cancel();
    if (page.canvas) {
      page.canvas.width = page.canvas.height = 0;
      page.canvas.remove();
      page.canvas = undefined;
    }
    page.problem?.remove();
    page.problem = undefined;
    page.status = "idle";
    page.placeholder.hidden = false;
  }

  function update() {
    frame = 0;
    if (stopped) return;
    const bounds = viewport.getBoundingClientRect();
    const candidates = [...nearby].map((page) => ({
      page,
      rect: page.node.getBoundingClientRect(),
    }));
    const visible = candidates
      .filter(
        ({ rect }) => rect.bottom > bounds.top && rect.top < bounds.bottom,
      )
      .sort((a, b) => {
        const overlap = ({ rect }) =>
          Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
        return overlap(b) - overlap(a) || a.page.index - b.page.index;
      });
    if (visible.length && document.activeElement !== pageInput)
      pageInput.value = visible[0].page.index + 1;
    const center = (bounds.top + bounds.bottom) / 2;
    const distance = ({ rect }) =>
      Math.max(0, rect.top - center, center - rect.bottom);
    wanted = candidates
      .sort((a, b) => distance(a) - distance(b) || a.page.index - b.page.index)
      .slice(0, retainedPages)
      .map(({ page }) => page);
    for (const page of pages)
      if (page.status !== "idle" && !wanted.includes(page)) recycle(page);
    void pump();
  }

  function schedule() {
    if (!frame && !stopped) frame = requestAnimationFrame(update);
  }

  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      while (!stopped) {
        const page = wanted.find((p) => p.status === "idle");
        if (!page) break;
        page.status = "rendering";
        const version = ++page.version;
        let source;
        try {
          source = await pdf.getPage(page.index + 1);
          if (stopped || page.version !== version) continue;
          const base = source.getViewport({ scale: 1 });
          page.node.style.aspectRatio = `${base.width} / ${base.height}`;
          const scale = Math.min(
            2,
            (Math.max(1, page.node.clientWidth) / base.width) *
              Math.min(window.devicePixelRatio || 1, 2),
            1600 / base.width,
            16384 / base.height,
            Math.sqrt(3_520_000 / (base.width * base.height)),
          );
          const view = source.getViewport({ scale });
          const canvas = el("canvas", { "aria-hidden": "true", hidden: true });
          canvas.width = Math.max(1, Math.floor(view.width));
          canvas.height = Math.max(1, Math.floor(view.height));
          page.canvas = canvas;
          page.node.append(canvas);
          page.render = source.render({
            canvasContext: canvas.getContext("2d"),
            viewport: view,
          });
          await page.render.promise;
          if (stopped || page.version !== version) continue;
          page.status = "ready";
          page.placeholder.hidden = true;
          canvas.hidden = false;
          readyResolve();
        } catch {
          if (stopped || page.version !== version) continue;
          page.status = "failed";
          page.placeholder.hidden = true;
          page.problem = el(
            "div",
            { class: "preview-problem", role: "alert" },
            el("p", {}, s.pdfError),
            el(
              "button",
              {
                type: "button",
                onclick: () => {
                  recycle(page);
                  void pump();
                },
              },
              s.retry,
            ),
          );
          page.node.append(page.problem);
          readyResolve();
        } finally {
          page.render = undefined;
          source?.cleanup();
        }
      }
    } finally {
      pumping = false;
    }
  }

  async function start() {
    const first = await pdf.getPage(1);
    if (stopped) return;
    const size = first.getViewport({ scale: 1 });
    pages = Array.from({ length: pdf.numPages }, (_, index) => {
      const placeholder = el(
        "span",
        { class: "pdf-placeholder" },
        `${s.page} ${index + 1}`,
      );
      const node = el(
        "div",
        {
          class: "pdf-page",
          role: "group",
          "aria-label": `${s.page} ${index + 1}`,
          "data-page": index + 1,
        },
        placeholder,
      );
      node.style.aspectRatio = `${size.width} / ${size.height}`;
      return { index, node, placeholder, status: "idle", version: 0 };
    });
    const fragment = document.createDocumentFragment();
    for (const page of pages) fragment.append(page.node);
    stack.append(fragment);
    const byNode = new Map(pages.map((page) => [page.node, page]));
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = byNode.get(entry.target);
          if (entry.isIntersecting) nearby.add(page);
          else nearby.delete(page);
        }
        schedule();
      },
      { root: viewport, rootMargin: "600px 0px" },
    );
    for (const page of pages) observer.observe(page.node);
    width = viewport.clientWidth;
    resizeObserver = new ResizeObserver(() => {
      if (Math.abs(viewport.clientWidth - width) < 1) return;
      width = viewport.clientWidth;
      for (const page of pages) if (page.status !== "idle") recycle(page);
      schedule();
    });
    resizeObserver.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true });
    pageInput.addEventListener("blur", schedule);
    nearby.add(pages[0]);
    update();
  }
  void start().catch((error) => {
    if (!stopped) readyReject(error);
  });
  return {
    ready,
    destroy() {
      stopped = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", schedule);
      pageInput.removeEventListener("blur", schedule);
      for (const page of pages) recycle(page);
      nearby.clear();
      readyResolve();
      controls.remove();
      viewport.remove();
      app.classList.remove("pdf-preview");
    },
  };
}
