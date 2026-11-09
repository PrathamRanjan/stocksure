// Ledger: related AG Grid tables with cross-filtering between orders, PayPal ops, receipts and negotiations.
(() => {
  const data = JSON.parse(document.getElementById("ledger-data").textContent);
  const bars = document.getElementById("status-bars");
  if (bars) {
    const entries = Object.entries(data.widgets.coverage.by_status);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    bars.innerHTML = entries.length ? entries.map(([k, v]) => `<div class="bar"><span class="lbl">${k.replace(/_/g, " ")}</span><span class="val" style="width:${(100 * v) / max}%"></span><span class="num">${v}</span></div>`).join("") : '<p class="muted small">No orders yet.</p>';
  }
  if (!window.agGrid) return;
  const usd = (p) => (p.value === null || p.value === undefined ? "" : `$${(Number(p.value) / 100).toFixed(2)}`);
  const when = (p) => (p.value ? new Date(p.value).toLocaleString() : "");
  const mk = (id, cols, rows, extra = {}) => {
    const el = document.getElementById(id);
    if (!el) return null;
    return agGrid.createGrid(el, { columnDefs: cols, rowData: rows, defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1, minWidth: 90 }, rowSelection: "single", animateRows: false, ...extra });
  };
  const grids = {};
  grids.orders = mk("grid-orders", [
    { field: "number", pinned: "left", minWidth: 120, cellRenderer: (p) => `<a href="/po/${p.data.id}">${p.value}</a>` },
    { field: "status" }, { field: "kind" }, { field: data.kind === "buyer" ? "supplier" : "buyer", minWidth: 140 },
    { field: "quote_cents", headerName: "Quoted", valueFormatter: usd }, { field: "spend_limit_cents", headerName: "Limit", valueFormatter: usd },
    { field: "captured_cents", headerName: "Captured", valueFormatter: usd }, { field: "refunded_cents", headerName: "Refunded", valueFormatter: usd }, { field: "billed_cents", headerName: "Billed", valueFormatter: usd },
    { field: "deliver_by", headerName: "Deliver by", valueFormatter: when, minWidth: 150 }, { field: "created_by_agent", headerName: "Agent" }, { field: "agreement_hash", headerName: "Agreement", valueFormatter: (p) => String(p.value || "").slice(0, 12) },
  ], data.orders, {
    onRowSelected: (e) => {
      if (!e.node.isSelected()) return;
      const o = e.data;
      grids.ops && grids.ops.setGridOption("rowData", data.ops.filter((x) => x.po_id === o.id));
      grids.receipts && grids.receipts.setGridOption("rowData", data.receipts.filter((x) => x.po_id === o.id));
      grids.negotiations && grids.negotiations.setGridOption("rowData", data.negotiations.filter((x) => x.po_id === o.id));
      showReset();
    },
  });
  grids.ops = mk("grid-ops", [
    { field: "number", headerName: "Order" }, { field: "kind" }, { field: "status" }, { field: "amount_cents", headerName: "Amount", valueFormatter: usd },
    { field: "paypal_id", headerName: "PayPal id", minWidth: 150 }, { field: "request_id", headerName: "Request id", minWidth: 150 }, { field: "attempts" }, { field: "created_at", headerName: "When", valueFormatter: when, minWidth: 150 },
  ], data.ops);
  grids.receipts = mk("grid-receipts", [
    { field: "number", headerName: "Order" }, { field: "version", headerName: "v" }, { field: "status" }, { field: "delivered_units", headerName: "Delivered" }, { field: "accepted_units", headerName: "Accepted" }, { field: "damaged_units", headerName: "Damaged" }, { field: "wrong_units", headerName: "Wrong" }, { field: "disputed_lines", headerName: "Disputed lines" }, { field: "confirmed_by", minWidth: 140 }, { field: "created_at", headerName: "When", valueFormatter: when, minWidth: 150 },
  ], data.receipts);
  grids.negotiations = mk("grid-negotiations", [
    { field: "number", headerName: "Order", cellRenderer: (p) => `<a href="/negotiations/${p.data.id}">${p.value}</a>` }, { field: "status" }, { field: "round" }, { field: "max_rounds", headerName: "Max" }, { field: "buyer_agent", minWidth: 140 }, { field: "supplier_agent", minWidth: 140 }, { field: "created_at", headerName: "Started", valueFormatter: when, minWidth: 150 },
  ], data.negotiations);
  grids.reliability = mk("grid-reliability", [
    { field: "supplier", minWidth: 120 }, { field: "orders" }, { field: "on_time_pct", headerName: "On time %" }, { field: "fill_rate_pct", headerName: "Fill %" }, { field: "damage_rate_pct", headerName: "Damage %" }, { field: "dispute_rate_pct", headerName: "Disputed %" }, { field: "invoice_accuracy_pct", headerName: "Invoice ok %" },
  ], data.widgets.reliability, {
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
