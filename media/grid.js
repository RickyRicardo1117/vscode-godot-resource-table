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

  const $toolbar = document.getElementById("toolbar");
  const $meta = document.getElementById("meta");
  const $thead = document.querySelector("#grid thead tr");
  const $tbody = document.querySelector("#grid tbody");

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "data") {
      columns = msg.columns || [];
      rows = (msg.rows || []).map((r) => ({ ...r }));
      colWidths = msg.colWidths || {};
      sortCol = "";
      sortDir = 1;
      if ($meta) {
        $meta.textContent = `${rows.length} resources · ${msg.rootPath || ""}`;
      }
      render();
    }
  });

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
    return c ? String(c.displayText ?? "") : "";
  }

  function render() {
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
      }
      const label = document.createElement("span");
      label.textContent = col;
      if (col === sortCol) {
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = sortDir > 0 ? "▲" : "▼";
        label.appendChild(mark);
      }
      th.appendChild(label);
      th.addEventListener("click", (e) => {
        if (e.target.classList && e.target.classList.contains("resize")) {
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
          colWidths[col] = nw;
        }
        function onUp() {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          vscode.postMessage({ type: "colWidths", colWidths: { ...colWidths } });
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
        const cell = row.cells[col];
        if (!cell || !cell.editable) {
          td.className = "readonly";
          td.textContent = cell ? cell.displayText : "";
        } else {
          td.className = "editable";
          td.textContent = cell.displayText;
          td.tabIndex = 0;
          td.addEventListener("dblclick", () => beginEdit(td, row, col, cell));
          td.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !td.classList.contains("editing")) {
              e.preventDefault();
              beginEdit(td, row, col, cell);
            }
          });
        }
        tr.appendChild(td);
      }
      $tbody.appendChild(tr);
    }
  }

  function beginEdit(td, row, col, cell) {
    if (td.classList.contains("editing")) {
      return;
    }
    td.classList.add("editing");
    td.innerHTML = "";
    const input = document.createElement("input");
    input.className = "cell-input";
    input.value = cell.displayText ?? "";
    td.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const newText = input.value;
      td.classList.remove("editing");
      td.innerHTML = "";
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

    input.addEventListener("blur", () => commit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        input.removeEventListener("blur", commit);
        cancel();
      }
    });
  }

  document.getElementById("btnRefresh")?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });
})();
