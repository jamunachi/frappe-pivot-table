/** pivot_table/public/js/pivot_boot.js
 * Frappe/ERPNext v15
 * Enhanced Pivot UI:
 *  - Plotly chart renderers (Bar/Stacked/Line/Area/Scatter)
 *  - Auto defaults (Rows/Cols/Value) + numeric coercion
 *  - Drill-down on click (shows raw rows)
 *  - Export CSV
 *  - Save/Load/Delete named presets (localStorage)
 *  - Derived date fields: Year/Quarter/Month/Day
 *  - Keep-alive button across report rerenders
 *  - Local libs first → CDN fallback
 */
(function () {
  const BTN_LABEL = __("Pivot");
  const DIALOG_TITLE = __("Pivot (beta)");
  const MAX_ROWS = 50000;
  const PRESET_NS = "__pivot_presets__"; // localStorage namespace

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
    // Core Pivot CSS
    await injectCSSWithFallback(
      "/assets/pivot_table/js/lib/pivottable/pivot.min.css",
      "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.css"
    );
    // jQuery UI for DnD
    if (!(window.jQuery && $.ui && $.ui.sortable && $.ui.draggable && $.ui.droppable)) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/jquery-ui.min.js",
        "https://cdn.jsdelivr.net/npm/jquery-ui@1.13.2/dist/jquery-ui.min.js"
      );
    }
    // PivotTable core
    if (!(window.jQuery && $.fn && $.fn.pivotUI)) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/pivottable/pivot.min.js",
        "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.js"
      );
    }
    // Plotly + PivotTable plotly renderers
    if (!window.Plotly) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/plotly-latest.min.js",
        "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"
      );
    }
    if (!($.pivotUtilities && $.pivotUtilities.plotly_renderers)) {
      await injectJSWithFallback(
        "/assets/pivot_table/js/lib/pivottable/plotly_renderers.min.js",
        "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/plotly_renderers.min.js"
      );
    }

    // Merge renderers so the chart renderers appear in the dropdown
    try {
      const utils = $.pivotUtilities || {};
      const std = utils.renderers || {};
      const plot = utils.plotly_renderers || {};
      $.pivotUtilities.renderers = $.extend({}, std, plot);
    } catch (e) {
      console.warn("[pivot] unable to merge plotly renderers", e);
    }

    console.log("[pivot] deps", {
      hasJQ: !!window.jQuery,
      hasUI: !!(window.jQuery && $.ui && $.ui.sortable),
      hasPivot: !!(window.jQuery && $.fn && $.fn.pivotUI),
      hasPlotly: !!window.Plotly,
      hasPlotlyRenderers: !!($.pivotUtilities && $.pivotUtilities.plotly_renderers)
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
        fb.onerror = () => resolve();
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
    // Build dialog UI (toolbar + target)
    const dlg = new frappe.ui.Dialog({ title: DIALOG_TITLE, size: "extra-large" });
    dlg.$body.css({ padding: 0 });

    const $wrap = $(`
      <div style="padding:12px;">
        <div id="pivot-toolbar" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
          <input id="pivot-preset-name" class="input-with-feedback form-control" placeholder="${__("Preset name")}" style="max-width:220px;">
          <button class="btn btn-sm btn-primary" id="pivot-save">${__("Save Preset")}</button>
          <select id="pivot-presets" class="input-with-feedback form-control" style="max-width:260px;">
            <option value="">${__("Load preset…")}</option>
          </select>
          <button class="btn btn-sm btn-default" id="pivot-delete" title="${__("Delete selected preset")}">🗑</button>
          <div style="flex:1"></div>
          <button class="btn btn-sm btn-default" id="pivot-derive">${__("Add Date Derivatives")}</button>
          <button class="btn btn-sm btn-default" id="pivot-export">${__("Export CSV")}</button>
          <button class="btn btn-sm btn-default" id="pivot-fullscreen">${__("Fullscreen")}</button>
        </div>
        <div id="pivot-log" style="font:12px/1.4 sans-serif; color:#666; margin-bottom:6px;"></div>
        <div id="pivot-target" style="min-height:560px;"></div>
      </div>
    `);

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

      // cap rows for responsiveness
      let sliced = rows;
      let clipped = false;
      if (rows.length > MAX_ROWS) { sliced = rows.slice(0, MAX_ROWS); clipped = true; }

      // labels and data normalization (AoA or AoO)
      const labels = cols.map((c, i) => c.label || c.fieldname || `Col ${i + 1}`);
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

      // numeric detection (from metadata; fallback to data)
      let numericKeys = cols
        .map((c, i) => ({ key: labels[i], ft: String(c.fieldtype || "").toLowerCase() }))
        .filter((x) => ["float", "currency", "int", "percent", "duration"].includes(x.ft))
        .map((x) => x.key);

      if (!numericKeys.length && data.length) {
        const sample = data[0];
        numericKeys = Object.keys(sample).filter((k) => isNumericLike(sample[k]));
      }

      // Coerce numeric-like strings → numbers
      if (numericKeys.length) {
        data.forEach((row) => {
          numericKeys.forEach((k) => {
            const v = row[k];
            if (typeof v === "string") {
              const n = parseFloat(v.replace(/[^\d.-]/g, ""));
              if (!isNaN(n)) row[k] = n;
            }
          });
        });
      }

      const dimKeys = labels.filter((k) => !numericKeys.includes(k));
      if (clipped) log(__("Showing first {0} rows out of {1}", [MAX_ROWS, rows.length])); else log("");

      // ---- presets (localStorage) ----
      const STORE_KEY = `__pivot_cfg__${report_name}`;
      const presetBucket = loadAllPresets();
      refreshPresetDropdown($("#pivot-presets"), presetBucket[report_name]);

      $("#pivot-save").on("click", () => {
        const name = ($("#pivot-preset-name").val() || "").trim();
        if (!name) return frappe.msgprint(__("Give this preset a name."));
        const cfg = currentPivotConfig();
        savePreset(report_name, name, cfg);
        refreshPresetDropdown($("#pivot-presets"), loadAllPresets()[report_name]);
        frappe.show_alert({ message: __("Preset saved"), indicator: "green" });
      });

      $("#pivot-delete").on("click", () => {
        const name = $("#pivot-presets").val();
        if (!name) return;
        deletePreset(report_name, name);
        refreshPresetDropdown($("#pivot-presets"), loadAllPresets()[report_name]);
        frappe.show_alert({ message: __("Preset deleted"), indicator: "orange" });
      });

      $("#pivot-presets").on("change", function () {
        const name = $(this).val();
        if (!name) return;
        const all = loadAllPresets();
        const cfg = all[report_name]?.[name];
        if (!cfg) return;
        renderPivot(cfg); // re-render with saved cfg
      });

      // ---- derived date fields ----
      $("#pivot-derive").on("click", () => {
        const dateCols = guessDateColumns(data, labels);
        if (!dateCols.length) {
          return frappe.msgprint(__("No obvious date columns found."));
        }
        const derived = buildDateDerivers(dateCols);
        renderPivot(null, derived); // merge-in derived attributes
        frappe.show_alert({ message: __("Derived date fields added"), indicator: "blue" });
      });

      // ---- export CSV ----
      $("#pivot-export").on("click", () => {
        const $tbl = $("#pivot-target table.pvtTable");
        if (!$tbl.length) return frappe.msgprint(__("Switch to a table renderer to export CSV."));
        const csv = tableToCSV($tbl[0]);
        downloadBlob(csv, `${report_name.replace(/\s+/g, "_")}_pivot.csv`, "text/csv;charset=utf-8;");
      });

      // ---- fullscreen toggle ----
      $("#pivot-fullscreen").on("click", () => {
        const el = dlg.$wrapper[0];
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else el.requestFullscreen?.();
      });

      // render once with smart defaults (or saved)
      const saved = safeJSON(localStorage.getItem(STORE_KEY)) || {};
      const defaults = {
        rows: saved.rows?.length ? saved.rows : (dimKeys[0] ? [dimKeys[0]] : []),
        cols: saved.cols?.length ? saved.cols : (dimKeys[1] ? [dimKeys[1]] : []),
        vals: saved.vals?.length ? saved.vals : (numericKeys[0] ? [numericKeys[0]] : []),
        aggregatorName: saved.aggregatorName || (numericKeys.length ? "Sum" : "Count"),
        rendererName: saved.rendererName || "Table",
      };

      renderPivot(defaults);

      // --- helpers bound to this data scope ---

      function renderPivot(cfgOverrides, derivedAttrs) {
        const cfg = Object.assign({
          rows: defaults.rows,
          cols: defaults.cols,
          vals: defaults.vals,
          aggregatorName: defaults.aggregatorName,
          rendererName: defaults.rendererName,
          derivedAttributes: Object.assign({}, (derivedAttrs || {})),
          rendererOptions: {
            table: {
              rowTotals: true,
              colTotals: true,
              clickCallback: (e, value, filters, pivotData) => {
                // collect underlying records for this cell
                const rows = [];
                pivotData.forEachMatchingRecord(filters, (record) => rows.push(record));
                showDrilldown(rows);
              }
            }
          },
          onRefresh: function (cfg2) {
            const clean = { ...cfg2 };
            delete clean.rendererOptions;
            delete clean.localeStrings;
            try { localStorage.setItem(STORE_KEY, JSON.stringify(clean)); } catch {}
          },
        }, cfgOverrides || {});

        // IMPORTANT: always pass same 'data' (array of objects)
        $("#pivot-target").pivotUI(data, cfg, true); // true → overwrite existing UI
      }

      function currentPivotConfig() {
        const cfg = safeJSON(localStorage.getItem(STORE_KEY)) || {};
        return cfg;
      }

    } catch (e) {
      console.error("[pivot] render error", e);
      log(__("Pivot failed: {0}", [String(e?.message || e)]));
    }
  }

  // ---------- utilities ----------

  function isNumericLike(v) {
    if (typeof v === "number") return true;
    if (typeof v !== "string") return false;
    const n = parseFloat(v.replace(/[^\d.-]/g, ""));
    return !isNaN(n);
  }

  function safeJSON(s) {
    try { return JSON.parse(s || ""); } catch { return null; }
  }

  function loadAllPresets() {
    return safeJSON(localStorage.getItem(PRESET_NS)) || {};
  }
  function saveAllPresets(all) {
    try { localStorage.setItem(PRESET_NS, JSON.stringify(all)); } catch {}
  }
  function savePreset(report_name, name, cfg) {
    const all = loadAllPresets();
    all[report_name] = all[report_name] || {};
    all[report_name][name] = cfg;
    saveAllPresets(all);
  }
  function deletePreset(report_name, name) {
    const all = loadAllPresets();
    if (all[report_name]) {
      delete all[report_name][name];
      saveAllPresets(all);
    }
  }
  function refreshPresetDropdown($sel, map) {
    const current = $sel.val() || "";
    $sel.empty().append(`<option value="">${__("Load preset…")}</option>`);
    if (map) {
      Object.keys(map).sort().forEach((k) => {
        $sel.append(`<option value="${frappe.utils.escape_html(k)}">${frappe.utils.escape_html(k)}</option>`);
      });
    }
    $sel.val(current);
  }

  function guessDateColumns(data, labels) {
    // naive inspect first 50 rows
    const maxCheck = Math.min(50, data.length);
    const dateish = new Set();
    for (const lbl of labels) {
      let score = 0;
      for (let i = 0; i < maxCheck; i++) {
        const v = data[i][lbl];
        if (!v) continue;
        const d = new Date(v);
        if (!isNaN(d.getTime())) score++;
      }
      if (score >= Math.ceil(maxCheck * 0.4)) dateish.add(lbl);
    }
    return Array.from(dateish);
  }

  function buildDateDerivers(dateCols) {
    // Create derived attributes (Year, Quarter, Month, Day) for each date column
    const out = {};
    const Q = (m) => "Q" + (Math.floor(m / 3) + 1);
    dateCols.forEach((col) => {
      out[`${col} (Year)`]   = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : d.getFullYear(); };
      out[`${col} (Quarter)`]= (r) => { const d = new Date(r[col]); return isNaN(d) ? null : Q(d.getMonth()); };
      out[`${col} (Month)`]  = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : (d.getMonth()+1).toString().padStart(2,"0"); };
      out[`${col} (Day)`]    = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : d.getDate().toString().padStart(2,"0"); };
    });
    return out;
  }

  function showDrilldown(rows) {
    if (!rows || !rows.length) {
      return frappe.msgprint(__("No matching rows for this cell."));
    }
    const dlg = new frappe.ui.Dialog({ title: __("Drill-down"), size: "extra-large" });
    const keys = Object.keys(rows[0] || {});
    const head = `<thead><tr>${keys.map(k => `<th>${frappe.utils.escape_html(k)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${rows.map(r =>
      `<tr>${keys.map(k => `<td style="white-space:nowrap;">${frappe.utils.escape_html(String(r[k] ?? ""))}</td>`).join("")}</tr>`
    ).join("")}</tbody>`;
    dlg.$body.html(`<div style="overflow:auto; max-height:70vh;"><table class="table table-bordered table-compact">${head}${body}</table></div>`);
    dlg.show();
  }

  function tableToCSV(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll("tr")) {
      const cells = [];
      for (const td of tr.querySelectorAll("th,td")) {
        let txt = td.innerText.replace(/\r?\n|\r/g, " ").trim();
        if (txt.includes('"') || txt.includes(",") || txt.includes("\n")) {
          txt = '"' + txt.replace(/"/g, '""') + '"';
        }
        cells.push(txt);
      }
      rows.push(cells.join(","));
    }
    return rows.join("\n");
  }

  function downloadBlob(content, name, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
})();
