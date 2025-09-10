/** pivot_table/public/js/pivot_boot.js
 * Frappe/ERPNext v15
 * - Adds a "Pivot" button to any Query Report
 * - Loads PivotTable.js + jQuery-UI (local first → CDN fallback)
 * - Keeps the button alive across toolbar re-renders
 * - Handles rows as arrays OR objects; shows debug text instead of a blank UI
 */
(function () {
  const BTN_LABEL = __("Pivot");
  const DIALOG_TITLE = __("Pivot (beta)");
  const MAX_ROWS = 50000;

  if (window.__frappe_pivot_boot_loaded__) return;
  window.__frappe_pivot_boot_loaded__ = true;

  let __pivotKeepAlive = null;

  frappe.router.on("change", attachWhenReady);
  frappe.after_ajax(attachWhenReady);

  function onQueryReportRoute() {
    const r = frappe.get_route();
    return r && r[0] === "query-report" && r[1];
  }

  function attachWhenReady() {
    if (!onQueryReportRoute()) return;

    const iv = setInterval(() => {
      if (frappe.query_report && frappe.query_report.page) {
        clearInterval(iv);
        addButton(frappe.query_report);
        ensureKeepAlive();
      }
    }, 150);
    setTimeout(() => clearInterval(iv), 4000);
  }

  function addButton(report) {
    const page = report.page;
    if (!page || !page.add_inner_button) return;

    const exists =
      page.inner_toolbar &&
      page.inner_toolbar.find &&
      page.inner_toolbar.find(".frappe-pivot-btn").length;
    if (exists) return;

    const $btn = page.add_inner_button(BTN_LABEL, async () => {
      try {
        await ensureDeps();
        await openPivot(report);
      } catch (err) {
        console.error("[pivot] fatal", err);
        frappe.msgprint({
          title: __("Pivot Error"),
          message: __("Unable to open the Pivot UI. See console for details."),
          indicator: "red",
        });
      }
    });
    $btn.addClass("frappe-pivot-btn");
  }

  function ensureKeepAlive() {
    if (__pivotKeepAlive) {
      clearInterval(__pivotKeepAlive);
      __pivotKeepAlive = null;
    }
    __pivotKeepAlive = setInterval(() => {
      try {
        if (!onQueryReportRoute()) {
          clearInterval(__pivotKeepAlive);
          __pivotKeepAlive = null;
          return;
        }
        const report = frappe.query_report;
        if (!report || !report.page) return;

        const page = report.page;
        const toolbar = page.inner_toolbar || page.wrapper?.find?.(".page-actions");
        if (!toolbar || !toolbar.length) return;

        if (!toolbar.find(".frappe-pivot-btn").length) addButton(report);
      } catch (e) {
        console.warn("[pivot] keepalive", e);
      }
    }, 700);
  }

  // ---------- dependency loaders ----------
  async function ensureDeps() {
    // Pivot CSS (prefer local; else CDN)
    await injectCSSWithFallback(
      "/assets/pivot_table/js/lib/pivottable/pivot.min.css",
      "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.css"
    );
    // jQuery-UI (DnD needed by pivotUI)
    if (!(window.jQuery && $.ui && $.ui.sortable && $.ui.draggable && $.ui.droppable)) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/jquery-ui.min.js",
        "https://cdn.jsdelivr.net/npm/jquery-ui@1.13.2/dist/jquery-ui.min.js"
      );
    }
    // PivotTable.js
    if (!(window.jQuery && $.fn && $.fn.pivotUI)) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/pivottable/pivot.min.js",
        "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.js"
      );
    }
    // Debug sanity
    console.log("[pivot] deps", {
      hasJQ: !!window.jQuery,
      hasUI: !!(window.jQuery && $.ui && $.ui.sortable),
      hasPivot: !!(window.jQuery && $.fn && $.fn.pivotUI),
    });
  }

  function injectCSSWithFallback(localHref, cdnHref) {
    return new Promise((resolve) => {
      if (document.querySelector(`link[href="${localHref}"]`) ||
          document.querySelector(`link[href="${cdnHref}"]`)) {
        return resolve();
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = localHref;
      link.onload = () => resolve();
      link.onerror = () => {
        const fb = document.createElement("link");
        fb.rel = "stylesheet";
        fb.href = cdnHref;
        fb.onload = () => resolve();
        fb.onerror = () => resolve(); // allow unstyled UI
        document.head.appendChild(fb);
      };
      document.head.appendChild(link);
    });
  }

  function injectJSWithFallback(localSrc, cdnSrc) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${localSrc}"]`) ||
          document.querySelector(`script[src="${cdnSrc}"]`)) {
        return resolve();
      }
      const s = document.createElement("script");
      s.src = localSrc;
      s.onload = () => resolve();
      s.onerror = () => {
        const f = document.createElement("script");
        f.src = cdnSrc;
        f.onload = () => resolve();
        f.onerror = (e) => reject(e);
        document.head.appendChild(f);
      };
      document.head.appendChild(s);
    });
  }

  // ---------- main ----------
  async function openPivot(report) {
    // Build dialog up front so messages are visible even on errors
    const dlg = new frappe.ui.Dialog({ title: DIALOG_TITLE, size: "extra-large" });
    dlg.$body.css({ padding: 0 });
    const $wrap = $(
      `<div style="padding:12px;">
         <div id="pivot-log" style="font:12px/1.4 sans-serif; color:#666; margin-bottom:6px;"></div>
         <div id="pivot-target" style="min-height:560px;"></div>
       </div>`
    );
    dlg.$body.append($wrap);
    dlg.show();

    const log = (msg) => $("#pivot-log").text(msg);

    try {
      const report_name = report.report_name || report.report_doc?.report_name;
      if (!report_name) throw new Error("Cannot detect report name");

      const filters =
        (report.get_filter_values && report.get_filter_values()) ||
        (report.get_values && report.get_values()) ||
        {};

      log(__("Running report…"));

      const { message } = await frappe.call({
        method: "frappe.desk.query_report.run",
        type: "POST",
        args: { report_name, filters },
      });

      const cols = message?.columns || [];
      const rows = message?.result || message?.values || [];

      console.log("[pivot] report meta", { cols: cols.length, rows: rows.length });

      if (!cols.length) { log(__("No columns returned from the report.")); return; }
      if (!rows.length) { log(__("No data returned for the current filters.")); return; }

      // cap size
      let sliced = rows;
      let clipped = false;
      if (rows.length > MAX_ROWS) { sliced = rows.slice(0, MAX_ROWS); clipped = true; }

      // labels
      const labels = cols.map((c, i) => c.label || c.fieldname || `Col ${i + 1}`);

      // Build array-of-objects for pivot, handling both shapes
      let data;
      if (Array.isArray(sliced[0])) {
        data = sliced.map((r) => {
          const o = {};
          labels.forEach((k, i) => (o[k] = r[i]));
          return o;
        });
      } else if (sliced[0] && typeof sliced[0] === "object") {
        data = sliced.map((obj) => {
          const o = {};
          labels.forEach((lbl, i) => {
            const c = cols[i];
            const key = c.fieldname || c.label || Object.keys(obj)[i];
            o[lbl] = obj[key];
          });
          return o;
        });
      } else {
        log(__("Unexpected data format from report."));
        return;
      }

      const numericKeys = cols
        .map((c, i) => ({ key: labels[i], ft: String(c.fieldtype || "").toLowerCase() }))
        .filter((x) => ["float", "currency", "int", "percent", "duration"].includes(x.ft))
        .map((x) => x.key);

      const aggregatorName = numericKeys.length ? "Sum" : "Count";
      const vals = numericKeys.length ? [numericKeys[0]] : [];

      if (clipped) log(__("Showing first {0} rows out of {1}", [MAX_ROWS, rows.length])); else log("");

      if (!($.fn && $.fn.pivotUI)) {
        log(__("Pivot library did not load. (CDN blocked?) Add local files under pivot_table/public/js/lib/ and rebuild."));
        return;
      }

      const STORE_KEY = `__pivot_cfg__${report_name}`;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch {}

      $("#pivot-target").pivotUI(data, {
        rows: saved.rows || [],
        cols: saved.cols || [],
        vals: saved.vals || vals,
        aggregatorName: saved.aggregatorName || aggregatorName,
        rendererName: saved.rendererName || "Table",
        onRefresh: function (cfg) {
          const clean = { ...cfg };
          delete clean.rendererOptions;
          delete clean.localeStrings;
          try { localStorage.setItem(STORE_KEY, JSON.stringify(clean)); } catch {}
        },
      });
    } catch (e) {
      console.error("[pivot] render error", e);
      log(__("Pivot failed: {0}", [String(e?.message || e)]));
    }
  }
})();
