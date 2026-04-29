// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {string[]} */
  let columns = [];
  /** @type {any[]} */
  let rows = [];
  /** @type {Record<string, number>} */
  let colWidths = {};
  let sortCol = "";
  let sortDir = 1; // 1 asc, -1 desc
  /** @type {string | null} Column id to pin with horizontal sticky (this column only). */
  let frozenThroughCol = null;

  const $toolbar = document.getElementById("toolbar");
  const $meta = document.getElementById("meta");
  const $thead = document.querySelector("#grid thead tr");
  const $tbody = document.querySelector("#grid tbody");
  const $wrap = document.querySelector(".wrap");

  /**
   * Full re-renders clear the table; the browser then moves focus and scrolls
   * (e.g. into the next tabindex cell). Capture scroll + focused cell and restore after rebuild.
   */
  function captureScrollAndFocus() {
    let scrollLeft = 0;
    let scrollTop = 0;
    if ($wrap) {
      scrollLeft = $wrap.scrollLeft;
      scrollTop = $wrap.scrollTop;
    }
    /** @type {{ absPath: string; col: string; kind: "bool" | "editable" } | null} */
    let restore = null;
    const ae = document.activeElement;
    if (ae && $tbody && $tbody.contains(ae)) {
      const td = ae.closest("td");
      if (td && td.dataset.absPath && td.dataset.col) {
        const isBool = td.classList.contains("cell-bool") || td.querySelector("input.cell-bool-input");
        const isEditable = td.classList.contains("editable");
        if (isBool || isEditable) {
          restore = { absPath: td.dataset.absPath, col: td.dataset.col, kind: isBool ? "bool" : "editable" };
        }
      }
    }
    return { scrollLeft, scrollTop, restore };
  }

  function scheduleScrollFocusRestore(saved) {
    if (!$wrap) {
      return;
    }
    requestAnimationFrame(() => {
      $wrap.scrollLeft = saved.scrollLeft;
      $wrap.scrollTop = saved.scrollTop;
      requestAnimationFrame(() => {
        $wrap.scrollLeft = saved.scrollLeft;
        $wrap.scrollTop = saved.scrollTop;
        if (!saved.restore) {
          return;
        }
        const ap = saved.restore.absPath;
        const col = saved.restore.col;
        const td = Array.from($tbody.querySelectorAll("td[data-abs-path]")).find(
          (el) => el.dataset.absPath === ap && el.dataset.col === col
        );
        if (!td) {
          return;
        }
        if (saved.restore.kind === "bool") {
          const inp = td.querySelector("input.cell-bool-input");
          if (inp) {
            inp.focus({ preventScroll: true });
            return;
          }
        }
        if (td.classList.contains("editable") && !td.querySelector("input.cell-bool-input")) {
          td.focus({ preventScroll: true });
        }
      });
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "themeColorScheme" && (msg.colorScheme === "light" || msg.colorScheme === "dark")) {
      document.documentElement.style.colorScheme = msg.colorScheme;
      return;
    }
    if (msg.type === "data") {
      columns = msg.columns || [];
      rows = (msg.rows || []).map((r) => ({ ...r }));
      colWidths = msg.colWidths || {};
      if (Object.prototype.hasOwnProperty.call(msg, "frozenThroughCol")) {
        frozenThroughCol = msg.frozenThroughCol;
      }
      if (sortCol && !columns.includes(sortCol)) {
        sortCol = "";
        sortDir = 1;
      }
      if ($meta) {
        $meta.textContent = `${rows.length} resources · ${msg.rootPath || ""}`;
      }
      render();
    }
  });

  function frozenThroughIndex() {
    if (!frozenThroughCol || columns.length === 0) {
      return -1;
    }
    const idx = columns.indexOf(frozenThroughCol);
    return idx >= 0 ? idx : -1;
  }

  function applyFrozenColumnLayout() {
    const ftIdx = frozenThroughIndex();
    const ths = $thead.querySelectorAll("th");
    const trs = $tbody.querySelectorAll("tr");
    for (let i = 0; i < columns.length; i += 1) {
      const th = ths[i];
      if (!th) {
        continue;
      }
      const frozen = ftIdx >= 0 && i === ftIdx;
      if (frozen) {
        th.classList.add("col-frozen", "col-frozen-edge");
        for (const tr of trs) {
          const td = tr.children[i];
          if (!td) {
            continue;
          }
          td.classList.add("col-frozen", "col-frozen-edge");
        }
      } else {
        th.classList.remove("col-frozen", "col-frozen-edge");
        for (const tr of trs) {
          const td = tr.children[i];
          if (td) {
            td.classList.remove("col-frozen", "col-frozen-edge");
          }
        }
      }
    }
  }

  function scheduleFrozenLayout() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyFrozenColumnLayout();
      });
    });
  }

  let ctxMenuEl = null;
  /** @type {((e: MouseEvent) => void) | null} */
  let ctxMenuDocClick = null;

  function closeCtxMenu() {
    if (ctxMenuEl && ctxMenuEl.parentNode) {
      ctxMenuEl.parentNode.removeChild(ctxMenuEl);
    }
    ctxMenuEl = null;
    if (ctxMenuDocClick) {
      document.removeEventListener("click", ctxMenuDocClick, true);
      ctxMenuDocClick = null;
    }
    document.removeEventListener("keydown", onCtxMenuKey, true);
  }

  function onCtxMenuKey(e) {
    if (e.key === "Escape") {
      closeCtxMenu();
    }
  }

  function showHeaderContextMenu(clientX, clientY, col) {
    closeCtxMenu();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.setAttribute("role", "menu");

    const btnFreeze = document.createElement("button");
    btnFreeze.type = "button";
    btnFreeze.textContent = `Pin column “${col}”`;
    btnFreeze.addEventListener("click", () => {
      closeCtxMenu();
      frozenThroughCol = col;
      vscode.postMessage({ type: "frozenColumns", frozenThroughCol: col });
      scheduleFrozenLayout();
    });

    const btnUnfreeze = document.createElement("button");
    btnUnfreeze.type = "button";
    btnUnfreeze.textContent = "Unpin column";
    btnUnfreeze.addEventListener("click", () => {
      closeCtxMenu();
      frozenThroughCol = null;
      vscode.postMessage({ type: "frozenColumns", frozenThroughCol: null });
      scheduleFrozenLayout();
    });

    menu.appendChild(btnFreeze);
    menu.appendChild(btnUnfreeze);
    document.body.appendChild(menu);
    ctxMenuEl = menu;

    const pad = 4;
    let x = clientX;
    let y = clientY;
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad;
    }
    menu.style.left = `${Math.max(pad, x)}px`;
    menu.style.top = `${Math.max(pad, y)}px`;

    ctxMenuDocClick = (e) => {
      if (!ctxMenuEl || ctxMenuEl.contains(/** @type {Node} */ (e.target))) {
        return;
      }
      closeCtxMenu();
    };
    setTimeout(() => {
      document.addEventListener("click", ctxMenuDocClick, true);
      document.addEventListener("keydown", onCtxMenuKey, true);
    }, 0);
  }

  function sortRows() {
    if (!sortCol) {
      return;
    }
    rows.sort((a, b) => {
      const av = cellText(a, sortCol);
      const bv = cellText(b, sortCol);
      const an = Number(av);
      const bn = Number(bv);
      if (av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) {
        return (an - bn) * sortDir;
      }
      return av.localeCompare(bv, undefined, { sensitivity: "base" }) * sortDir;
    });
  }

  function cellText(row, col) {
    const c = row.cells[col];
    if (c === null || c === undefined || typeof c !== "object") {
      return "";
    }
    return String(c.displayText ?? "");
  }

  function clearColumnDragClasses() {
    for (const el of document.querySelectorAll("thead th.col-drop-target, thead th.col-dragging")) {
      el.classList.remove("col-drop-target", "col-dragging");
    }
  }

  /**
   * Move `fromCol` next to `refCol`: before ref’s cell if insertAfter is false, after if true.
   * Display only; order is persisted via the extension workspace state.
   */
  function moveColumnRelative(fromCol, refCol, insertAfter) {
    if (fromCol === refCol) {
      return;
    }
    const next = columns.slice();
    const fi = next.indexOf(fromCol);
    if (fi < 0) {
      return;
    }
    next.splice(fi, 1);
    let ti = next.indexOf(refCol);
    if (ti < 0) {
      return;
    }
    if (insertAfter) {
      ti += 1;
    }
    next.splice(ti, 0, fromCol);
    columns = next;
    vscode.postMessage({ type: "columnOrder", columns: [...columns] });
    render();
  }

  function render() {
    const saved = captureScrollAndFocus();
    sortRows();
    $thead.innerHTML = "";
    $tbody.innerHTML = "";
    for (const col of columns) {
      const th = document.createElement("th");
      th.className = "sortable";
      const w = colWidths[col];
      if (w) {
        th.style.width = w + "px";
        th.style.minWidth = w + "px";
        th.style.maxWidth = w + "px";
      }
      const handle = document.createElement("span");
      handle.className = "col-drag-handle";
      handle.textContent = "⋮⋮";
      handle.setAttribute("draggable", "true");
      handle.setAttribute("aria-label", `Reorder column “${col}”`);
      handle.title = "Drag to reorder column";
      handle.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", col);
        e.dataTransfer.effectAllowed = "move";
        th.classList.add("col-dragging");
      });
      handle.addEventListener("dragend", () => {
        clearColumnDragClasses();
      });
      handle.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      th.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      th.addEventListener("dragenter", (e) => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes("text/plain")) {
          return;
        }
        th.classList.add("col-drop-target");
      });
      th.addEventListener("dragleave", (e) => {
        const rt = e.relatedTarget;
        if (rt instanceof Node && th.contains(rt)) {
          return;
        }
        th.classList.remove("col-drop-target");
      });
      th.addEventListener("drop", (e) => {
        e.preventDefault();
        clearColumnDragClasses();
        const fromCol = e.dataTransfer.getData("text/plain");
        if (!fromCol) {
          return;
        }
        const rect = th.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        const insertAfter = e.clientX >= mid;
        moveColumnRelative(fromCol, col, insertAfter);
      });
      const label = document.createElement("span");
      label.className = "header-label";
      label.textContent = col;
      if (col === sortCol) {
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = sortDir > 0 ? "▲" : "▼";
        label.appendChild(mark);
      }
      const inner = document.createElement("div");
      inner.className = "th-inner";
      inner.appendChild(handle);
      inner.appendChild(label);
      th.appendChild(inner);
      th.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showHeaderContextMenu(e.clientX, e.clientY, col);
      });
      th.addEventListener("click", (e) => {
        if (e.target.classList && e.target.classList.contains("resize")) {
          return;
        }
        if (e.target.closest && e.target.closest(".col-drag-handle")) {
          return;
        }
        if (sortCol === col) {
          sortDir *= -1;
        } else {
          sortCol = col;
          sortDir = 1;
        }
        render();
      });
      const rz = document.createElement("span");
      rz.className = "resize";
      let startX = 0;
      let startW = 0;
      rz.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        startX = ev.clientX;
        startW = th.offsetWidth;
        function onMove(e2) {
          const nw = Math.max(48, startW + (e2.clientX - startX));
          th.style.width = nw + "px";
          th.style.minWidth = nw + "px";
          th.style.maxWidth = nw + "px";
          colWidths[col] = nw;
        }
        function onUp() {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          vscode.postMessage({ type: "colWidths", colWidths: { ...colWidths } });
          scheduleFrozenLayout();
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
      th.appendChild(rz);
      $thead.appendChild(th);
    }

    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const col of columns) {
        const td = document.createElement("td");
        const cw = colWidths[col];
        if (cw) {
          td.style.width = cw + "px";
          td.style.minWidth = cw + "px";
          td.style.maxWidth = cw + "px";
        }
        const cell = row.cells[col];
        td.dataset.absPath = row.absPath;
        td.dataset.col = col;
        if (cell === null || cell === undefined || typeof cell !== "object" || cell.editable !== true) {
          td.className = "readonly";
          if (cell !== null && cell !== undefined && typeof cell === "object" && cell.applicable === false) {
            td.classList.add("not-applicable");
            td.setAttribute("aria-disabled", "true");
          }
          if (cell !== null && cell !== undefined && typeof cell === "object" && cell.atScriptDefault) {
            td.classList.add("at-default");
          }
          td.textContent =
            cell !== null && cell !== undefined && typeof cell === "object"
              ? String(cell.displayText ?? "")
              : "";
        } else {
          td.className = "editable";
          if (cell.atScriptDefault) {
            td.classList.add("at-default");
          }
          if (cell.kind === "bool") {
            mountBoolToggle(td, row, col, cell);
          } else {
            td.textContent = String(cell.displayText ?? "");
            td.tabIndex = 0;
            td.addEventListener("click", () => beginEdit(td, row, col, cell));
            td.addEventListener("keydown", (e) => {
              if (e.key === "Enter" && !td.classList.contains("editing")) {
                e.preventDefault();
                beginEdit(td, row, col, cell);
              }
            });
          }
        }
        tr.appendChild(td);
      }
      $tbody.appendChild(tr);
    }
    scheduleFrozenLayout();
    scheduleScrollFocusRestore(saved);
  }

  function bindTextareaAutosize(ta) {
    const resize = () => {
      ta.style.height = "0";
      ta.style.height = `${ta.scrollHeight}px`;
    };
    ta.addEventListener("input", resize);
    resize();
  }

  function mountBoolToggle(td, row, col, cell) {
    td.classList.add("cell-bool");
    td.innerHTML = "";
    const label = document.createElement("label");
    label.className = "cell-bool-toggle";
    label.setAttribute("aria-label", col);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cell-bool-input";
    const raw = String(cell.rawValue ?? cell.displayText ?? "")
      .trim()
      .toLowerCase();
    input.checked = raw === "true";
    const track = document.createElement("span");
    track.className = "cell-bool-track";
    const thumb = document.createElement("span");
    thumb.className = "cell-bool-thumb";
    track.appendChild(thumb);
    label.appendChild(input);
    label.appendChild(track);
    td.appendChild(label);

    input.addEventListener("change", () => {
      const newText = input.checked ? "true" : "false";
      vscode.postMessage({
        type: "applyEdit",
        absPath: row.absPath,
        col,
        newText,
        prevDisplay: cell.displayText,
        kind: cell.kind,
      });
    });
  }

  function beginEnumSelectEdit(td, row, col, cell) {
    td.classList.add("editing");
    td.innerHTML = "";
    const members = cell.enumMembers;
    const sorted = [...members].sort((a, b) => a.value - b.value);
    const rawTrim = String(cell.rawValue ?? "").trim();
    const currentNum = Number.parseInt(rawTrim, 10);
    const hasValidNum = !Number.isNaN(currentNum);
    const valueSet = new Set(sorted.map((m) => m.value));

    const sel = document.createElement("select");
    sel.className = "cell-input cell-input-select";
    sel.setAttribute("aria-label", col);

    if (hasValidNum && !valueSet.has(currentNum)) {
      const orphan = document.createElement("option");
      orphan.value = String(currentNum);
      orphan.textContent = cell.displayText ?? String(currentNum);
      sel.appendChild(orphan);
    }
    for (const m of sorted) {
      const opt = document.createElement("option");
      opt.value = String(m.value);
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
    if (hasValidNum) {
      sel.value = String(currentNum);
    }
    const initialValue = sel.value;

    td.appendChild(sel);
    sel.focus();

    let finished = false;

    function teardownListeners() {
      sel.removeEventListener("blur", onBlur);
      sel.removeEventListener("change", onChange);
    }

    function cancelSelect() {
      if (finished) {
        return;
      }
      finished = true;
      teardownListeners();
      td.classList.remove("editing");
      td.textContent = cell.displayText ?? "";
    }

    function commitSelect() {
      if (finished) {
        return;
      }
      finished = true;
      teardownListeners();
      const newText = sel.value;
      td.classList.remove("editing");
      td.innerHTML = "";
      const chosen = sorted.find((m) => String(m.value) === newText);
      td.textContent = chosen !== undefined ? chosen.name : cell.displayText ?? newText;
      vscode.postMessage({
        type: "applyEdit",
        absPath: row.absPath,
        col,
        newText,
        prevDisplay: cell.displayText,
        kind: cell.kind,
      });
    }

    function onChange() {
      if (sel.value !== initialValue) {
        commitSelect();
      }
    }

    function onBlur() {
      if (finished || !td.classList.contains("editing")) {
        return;
      }
      if (sel.value !== initialValue) {
        commitSelect();
      } else {
        cancelSelect();
      }
    }

    sel.addEventListener("change", onChange);
    sel.addEventListener("blur", onBlur);
    sel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelSelect();
      }
    });
  }

  function beginEdit(td, row, col, cell) {
    if (td.classList.contains("editing")) {
      return;
    }
    if (cell.kind === "bool") {
      return;
    }
    if (
      cell.kind === "enum" &&
      Array.isArray(cell.enumMembers) &&
      cell.enumMembers.length > 0
    ) {
      beginEnumSelectEdit(td, row, col, cell);
      return;
    }
    td.classList.add("editing");
    td.innerHTML = "";
    const el = document.createElement("textarea");
    el.className = "cell-input";
    el.value = cell.displayText ?? "";
    td.appendChild(el);
    bindTextareaAutosize(el);
    el.focus();
    el.select();

    function commit() {
      const newText = el.value;
      td.classList.remove("editing");
      td.innerHTML = "";
      td.textContent = newText;
      vscode.postMessage({
        type: "applyEdit",
        absPath: row.absPath,
        col,
        newText,
        prevDisplay: cell.displayText,
        kind: cell.kind,
      });
    }

    function cancel() {
      td.classList.remove("editing");
      td.textContent = cell.displayText ?? "";
    }

    function onBlur() {
      commit();
    }

    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        el.removeEventListener("blur", onBlur);
        cancel();
      }
    });
  }

  document.getElementById("btnRefresh")?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  window.addEventListener("resize", () => {
    scheduleFrozenLayout();
  });
})();
