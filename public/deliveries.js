// Bryntum Scheduler (trial build via jsDelivr): open orders by counterparty over time, coloured by state, Now line.
// A supplier dragging an order to a later time asks the server whether the ETA can be recorded; nothing is written
// until they confirm on the verdict banner.
const BRYNTUM = "https://cdn.jsdelivr.net/npm/@bryntum/scheduler-trial@7.3.8";
const el = document.getElementById("bryntum-deliveries");
const out = document.getElementById("bryntum-verdict");
if (el) {
  if (document.documentElement.classList.contains("dark")) {
    const link = document.getElementById("bryntum-theme");
    if (link) link.href = `${BRYNTUM}/svalbard-dark.css`;
  }
  try {
    const [{ Scheduler }, data] = await Promise.all([import(`${BRYNTUM}/scheduler.module.js`), fetch(el.dataset.src, { credentials: "same-origin" }).then((r) => r.json())]);
    const draggable = el.dataset.draggable === "1";
    const scheduler = new Scheduler({
      appendTo: el,
      height: 480,
      startDate: new Date(data.start),
      endDate: new Date(data.end),
      viewPreset: "dayAndWeek",
      rowHeight: 40,
      barMargin: 5,
      columns: [{ text: "Counterparty", field: "name", width: 220 }],
      resources: data.resources,
      events: data.events,
      features: { eventResize: false, eventEdit: false, eventDragCreate: false, cellEdit: false, timeRanges: { showCurrentTimeLine: true }, eventDrag: { constrainDragToResource: true, disabled: !draggable } },
      listeners: {
        async beforeEventDropFinalize({ context }) {
          context.async = true;
          const ev = context.eventRecords[0];
          const when = context.endDate || context.startDate;
          const r = await fetch(`${el.dataset.check}?po=${encodeURIComponent(ev.poId || ev.id)}&when=${encodeURIComponent(new Date(when).toISOString())}`, { credentials: "same-origin" }).then((x) => x.json());
          if (out) {
            out.className = `banner ${r.ok ? (r.late ? "warn" : "good") : "bad"}`;
            out.innerHTML = "";
            out.append(document.createTextNode(r.message + " "));
            if (r.ok) {
              const f = document.createElement("form");
              f.method = "post";
              f.action = el.dataset.move;
              f.className = "inline";
              const po = document.createElement("input"); po.type = "hidden"; po.name = "po"; po.value = r.po;
              const w = document.createElement("input"); w.type = "hidden"; w.name = "when"; w.value = r.when;
              const b = document.createElement("button"); b.className = "btn small primary"; b.textContent = "Record this ETA";
              f.append(po, w, b);
              out.append(f);
            }
          }
          context.finalize(false);
        },
        eventClick({ eventRecord }) {
          if (eventRecord.poId) window.open(`/po/${eventRecord.poId}`, "_blank", "noopener");
        },
      },
    });
    window.stocksureScheduler = scheduler;
  } catch (e) {
    el.innerHTML = `<div class="banner warn">The interactive board could not load (${String(e.message || e)}). The ledger lists the same orders.</div>`;
  }
}
