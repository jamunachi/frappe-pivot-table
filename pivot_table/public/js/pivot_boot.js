/** pivot_table/public/js/pivot_boot.js
 * Frappe/ERPNext v15
 * - Adds a "Pivot" button to any Query Report
 * - Re-runs the report with current filters
 * - Loads PivotTable.js + jQuery-UI (local if present → else CDN)
 * - Saves pivot layout per report (localStorage)
 */
(function () {
  const BTN_LABEL = __("Pivot");
  const DIALOG_TITLE = __("Pivot (beta)");
  const MAX_ROWS = 50000;

  if (window.__frappe_pivot_boot_loaded__) return;
  window.__frappe_pivot_boot_loaded__ = true;

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
      }
    }, 150);
    setTimeout(() => clearInterval(iv), 4000);
  }

  function addButton(report) {
    const page = report.page;
    if (!page || !page.add_inner_button) return;
    const exists = page.inner_toolbar?.find(".frappe-pivot-btn").length;
    if (exists) return;

    const $btn = page.add_inner_button(BTN_LABEL, async () => {
      try {
        await ensureDeps();
        await openPivot(report);
      } catch (err) {
        console.error("[frappe-pivot-table]", err);
        frappe.msgprint({
          title: __("Pivot Error"),
          message: __("Unable to open the Pivot UI. Check console for details."),
          indicator: "red",
        });
      }
    });
    $btn.addClass("frappe-pivot-btn");
  }

  async function ensureDeps() {
    // CSS (Pivot)
    await injectCSSWithFallback(
      "/assets/pivot_table/js/lib/pivottable/pivot.min.css",
      "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.css"
    );
    // jQuery UI (drag/drop)
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
  }

  function injectCSSWithFallback(localHref, cdnHref) {
    return new Promise((resolve) => {
      if (document.querySelector(`link[href="${localHref}"]`) || document.querySelector(`link[href="${cdnHref}"]`)) {
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
        fb.onerror = () => resolve(); // allow JS to work even if CSS fails
        document.head.appendChild(fb);
      };
      document.head.appendChild(link);
    });
  }

  function injectJSWithFallback(localSrc, cdnSrc) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${localSrc}"]`) || document.querySelector(`script[src="${cdnSrc}"]`)) {
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

  async function openPivot(report) {
    const report_name = report.report_name || report.report_doc?.report_name;
    if (!report_name) throw new Error("Cannot detect report name");

    const filters =
      (report.get_filter_values && report.get_filter_values()) ||
      (report.get_values && report.get_values()) ||
      {};

    const { message } = await frappe.call({
      method: "frappe.desk.query_report.run",
      type: "POST",
      args: { report_name, filters },
    });

    const cols = message?.columns || [];
    const rows = message?.result || message?.values || [];
    if (!cols.length) {
      frappe.msgprint({ message: __("No columns returned from this report."), indicator: "orange" });
      return;
    }
    if (!rows.length) {
      frappe.msgprint({ message: __("No data for current filters."), indicator: "orange" });
      return;
    }

    let clipped = false;
    let _rows = rows;
    if (rows.length > MAX_ROWS) {
      _rows = rows.slice(0, MAX_ROWS);
      clipped = true;
    }

    const labels = cols.map((c, i) => c.label || c.fieldname || `Col ${i + 1}`);
    const data = _rows.map((r) => {
      const o = {};
      labels.forEach((k, i) => (o[k] = r[i]));
      return o;
    });

    const numericKeys = cols
      .map((c, i) => ({ key: labels[i], ft: String(c.fieldtype || "").toLowerCase() }))
      .filter((x) => ["float", "currency", "int", "percent", "duration"].includes(x.ft))
      .map((x) => x.key);

    const aggregatorName = numericKeys.length ? "Sum" : "Count";
    const vals = numericKeys.length ? [numericKeys[0]] : [];

    const dlg = new frappe.ui.Dialog({ title: DIALOG_TITLE, size: "extra-large" });
    dlg.$body.css({ padding: 0 });

    const notice = clipped
      ? `<div style="padding:8px 12px; font-size:12px; color:#666;">
           ${__("Showing first {0} rows out of {1}", [MAX_ROWS, rows.length])}
         </div>` : "";

    const $wrap = $(
      `<div style="padding:12px;">
         ${notice}
         <div id="pivot-target" style="min-height:560px;"></div>
       </div>`
    );
    dlg.$body.append($wrap);
    dlg.show();

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
  }
})();
