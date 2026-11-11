// Ledger: AG Grid Enterprise. Related tables with cross-filtering between orders, PayPal ops, receipts and
// negotiations; row grouping by supplier, status or month; master-detail rows with each order's PayPal record;
// an integrated chart of supplier reliability; Excel export of three sheets; a saved view per browser.
(() => {
  const data = JSON.parse(document.getElementById("ledger-data").textContent);
  const bars = document.getElementById("status-bars");
  if (bars) {
    const entries = Object.entries(data.widgets.coverage.by_status);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    bars.innerHTML = entries.length ? entries.map(([k, v]) => `<div class="bar"><span class="lbl">${k.replace(/_/g, " ")}</span><span class="val" style="width:${(100 * v) / max}%"></span><span class="num">${v}</span></div>`).join("") : '<p class="muted small">No orders yet.</p>';
  }
  if (!window.agGrid) return;
  if (data.ag_license && agGrid.LicenseManager) agGrid.LicenseManager.setLicenseKey(data.ag_license);
  const status = (t) => {
    const el = document.getElementById("view-status");
    if (el) el.textContent = t;
  };
  const usd = (p) => (p.value === null || p.value === undefined ? "" : `$${(Number(p.value) / 100).toFixed(2)}`);
  const when = (p) => (p.value ? new Date(p.value).toLocaleString() : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  for (const o of data.orders) o.month = String(o.created_at || "").slice(0, 7);
  const money = (field, headerName) => ({ field, headerName, valueFormatter: usd, aggFunc: "sum", type: "numericColumn" });
  const mk = (id, cols, rows, extra = {}) => {
    const el = document.getElementById(id);
    if (!el) return null;
    return agGrid.createGrid(el, { columnDefs: cols, rowData: rows, defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1, minWidth: 90, enableRowGroup: true }, rowSelection: { mode: "singleRow", checkboxes: false, enableClickSelection: true }, animateRows: false, ...extra });
  };
  const grids = {};
  const opsCols = [
    { field: "kind" }, { field: "status" }, { field: "amount_cents", headerName: "Amount", valueFormatter: usd },
    { field: "paypal_id", headerName: "PayPal id", minWidth: 160 }, { field: "paypal_status", headerName: "PayPal status" }, { field: "request_id", headerName: "Request id", minWidth: 150 }, { field: "created_at", headerName: "When", valueFormatter: when, minWidth: 150 },
  ];
  grids.orders = mk("grid-orders", [
    { field: "number", pinned: "left", minWidth: 140, cellRenderer: "agGroupCellRenderer", cellRendererParams: { innerRenderer: (p) => (p.data ? `<a href="/po/${esc(p.data.id)}">${esc(p.value)}</a>` : esc(p.value)) } },
    { field: "status" }, { field: "kind" }, { field: data.kind === "buyer" ? "supplier" : "buyer", minWidth: 140 }, { field: "month", headerName: "Month" },
    money("quote_cents", "Quoted"), money("spend_limit_cents", "Limit"), money("captured_cents", "Captured"), money("refunded_cents", "Refunded"), money("billed_cents", "Billed"),
    { field: "deliver_by", headerName: "Deliver by", valueFormatter: when, minWidth: 150 }, { field: "created_by_agent", headerName: "Agent" }, { field: "agreement_hash", headerName: "Agreement", valueFormatter: (p) => String(p.value || "").slice(0, 12) },
  ], data.orders, {
    rowGroupPanelShow: "always",
    // Open supplier/month groups, but keep each order's PayPal detail closed until asked for.
    isGroupOpenByDefault: (p) => p.level === 0,
    suppressAggFuncInHeader: true,
    sideBar: { toolPanels: ["columns", "filters"] },
    cellSelection: true,
    enableCharts: true,
    // Master-detail: each order opens to its PayPal record, read from StockSure's payment_ops.
    masterDetail: true,
    detailRowAutoHeight: true,
    detailCellRendererParams: {
      detailGridOptions: { columnDefs: opsCols, defaultColDef: { flex: 1, minWidth: 90, resizable: true } },
      getDetailRowData: (p) => p.successCallback(data.ops.filter((x) => x.po_id === p.data.id)),
    },
    onRowSelected: (e) => {
      if (!e.node.isSelected() || !e.data) return;
      const o = e.data;
      grids.ops && grids.ops.setGridOption("rowData", data.ops.filter((x) => x.po_id === o.id));
      grids.receipts && grids.receipts.setGridOption("rowData", data.receipts.filter((x) => x.po_id === o.id));
      grids.negotiations && grids.negotiations.setGridOption("rowData", data.negotiations.filter((x) => x.po_id === o.id));
      showReset();
    },
  });
  grids.ops = mk("grid-ops", [{ field: "number", headerName: "Order" }, ...opsCols, { field: "attempts" }], data.ops);
  grids.receipts = mk("grid-receipts", [
    { field: "number", headerName: "Order" }, { field: "version", headerName: "v" }, { field: "status" }, { field: "delivered_units", headerName: "Delivered" }, { field: "accepted_units", headerName: "Accepted" }, { field: "damaged_units", headerName: "Damaged" }, { field: "wrong_units", headerName: "Wrong" }, { field: "disputed_lines", headerName: "Disputed lines" }, { field: "confirmed_by", minWidth: 140 }, { field: "created_at", headerName: "When", valueFormatter: when, minWidth: 150 },
  ], data.receipts);
  grids.negotiations = mk("grid-negotiations", [
    { field: "number", headerName: "Order", cellRenderer: (p) => `<a href="/negotiations/${esc(p.data.id)}">${esc(p.value)}</a>` }, { field: "status" }, { field: "round" }, { field: "max_rounds", headerName: "Max" }, { field: "buyer_agent", minWidth: 140 }, { field: "supplier_agent", minWidth: 140 }, { field: "created_at", headerName: "Started", valueFormatter: when, minWidth: 150 },
  ], data.negotiations);
  const relCols = ["on_time_pct", "fill_rate_pct", "damage_rate_pct", "dispute_rate_pct", "invoice_accuracy_pct"];
  grids.reliability = mk("grid-reliability", [
    { field: "supplier", minWidth: 120, chartDataType: "category" }, { field: "orders", chartDataType: "excluded" }, { field: "on_time_pct", headerName: "On time %", chartDataType: "series" }, { field: "fill_rate_pct", headerName: "Fill %", chartDataType: "series" }, { field: "damage_rate_pct", headerName: "Damage %", chartDataType: "series" }, { field: "dispute_rate_pct", headerName: "Disputed %", chartDataType: "series" }, { field: "invoice_accuracy_pct", headerName: "Invoice ok %", chartDataType: "series" },
  ], data.widgets.reliability, {
    cellSelection: true,
    enableCharts: true,
    onFirstDataRendered: (e) => {
      const el = document.getElementById("chart-reliability");
      if (!el || !data.widgets.reliability.length) {
        if (el) el.innerHTML = '<p class="muted small">No supplier history yet.</p>';
        return;
      }
      e.api.createRangeChart({ chartContainer: el, cellRange: { columns: ["supplier", ...relCols] }, chartType: "groupedColumn", suppressChartRanges: true });
      fixChartA11y(el);
    },
    onRowSelected: (e) => {
      if (!e.node.isSelected()) return;
      const s = e.data;
      const ids = new Set(data.orders.filter((o) => o.supplier_id === s.supplier_id).map((o) => o.id));
      grids.orders && grids.orders.setGridOption("rowData", data.orders.filter((o) => ids.has(o.id)));
      grids.ops && grids.ops.setGridOption("rowData", data.ops.filter((x) => ids.has(x.po_id)));
      grids.receipts && grids.receipts.setGridOption("rowData", data.receipts.filter((x) => ids.has(x.po_id)));
      showReset();
    },
  });

  // AG Charts 10 (bundled with AG Grid 32.3.3) labels its plot area by an empty element and puts aria-orientation on
  // a list, which axe reports. Correct both in place, and keep correcting as the chart redraws.
  function fixChartA11y(el) {
    const fix = () => {
      for (const n of el.querySelectorAll("[role=list][aria-orientation], [role=group][aria-orientation]")) n.removeAttribute("aria-orientation");
      for (const n of el.querySelectorAll(".ag-charts-series-area[role=img]")) {
        const ref = n.getAttribute("aria-labelledby");
        const target = ref && document.getElementById(ref);
        if (!target || !target.textContent.trim()) {
          if (ref) n.removeAttribute("aria-labelledby");
          if (!n.getAttribute("aria-label")) n.setAttribute("aria-label", "Supplier reliability chart: on time, fill, damage, disputed and invoice accuracy per supplier, the same figures as the reliability table above.");
        }
      }
    };
    fix();
    new MutationObserver(fix).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-orientation", "aria-labelledby"] });
  }

  // Toolbar: grouping presets, Excel export of three sheets, a saved view kept in this browser only.
  const on = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", fn);
  };
  const group = (field) => {
    grids.orders.applyColumnState({ state: [{ colId: field, rowGroup: true, hide: true }], defaultState: { rowGroup: false, hide: false } });
    status(`Grouped by ${field}.`);
  };
  on("view-supplier", () => group(data.kind === "buyer" ? "supplier" : "buyer"));
  on("view-month", () => group("month"));
  on("view-reset", () => {
    grids.orders.resetColumnState();
    status("View reset.");
  });
  const KEY = "stocksure.ledger.view";
  on("view-save", () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(grids.orders.getColumnState()));
      status("View saved in this browser.");
    } catch {
      status("This browser won't store the view (private window?).");
    }
  });
  on("view-load", () => {
    try {
      const v = localStorage.getItem(KEY);
      if (!v) return status("No saved view yet.");
      grids.orders.applyColumnState({ state: JSON.parse(v), applyOrder: true });
      status("Saved view loaded.");
    } catch {
      status("The saved view couldn't be read.");
    }
  });
  on("xl-export", () => {
    const sheets = [grids.orders, grids.ops, grids.receipts].filter(Boolean).map((g, i) => g.getSheetDataForExcel({ sheetName: ["Orders", "PayPal operations", "Receipts"][i] }));
    grids.orders.exportMultipleSheetsAsExcel({ data: sheets, fileName: "stocksure-ledger.xlsx" });
    status("Excel file downloaded.");
  });

  function showReset() {
    if (document.getElementById("reset-filters")) return;
    const b = document.createElement("button");
    b.id = "reset-filters";
    b.className = "btn small";
    b.textContent = "Clear cross-filter";
    b.style.margin = "8px 0";
    b.onclick = () => {
      grids.orders.setGridOption("rowData", data.orders);
      grids.ops.setGridOption("rowData", data.ops);
      grids.receipts.setGridOption("rowData", data.receipts);
      grids.negotiations.setGridOption("rowData", data.negotiations);
      grids.orders.deselectAll();
      grids.reliability.deselectAll();
      b.remove();
    };
    document.querySelector("h1").after(b);
  }
})();
