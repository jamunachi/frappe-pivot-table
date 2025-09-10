/** pivot_table/public/js/pivot_boot.js
 * Enhanced Pivot (server presets)
 * - Plotly renderers, auto defaults, numeric coercion, drill-down, CSV, date-derivers
 * - Shared presets via server (plus localStorage fallback)
 * - Keep-alive button, CDN fallback for libs
 */
(function () {
  const BTN_LABEL = __("Pivot");
  const DIALOG_TITLE = __("Pivot (beta)");
  const MAX_ROWS = 50000;
  const PRESET_NS = "__pivot_presets__"; // local fallback

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
    if (page.inner_toolbar?.find(".frappe-pivot-btn").length) return;

    const $btn = page.add_inner_button(BTN_LABEL, async () => {
      try {
        await ensureDeps();
        await openPivot(report);
      } catch (err) {
        console.error("[pivot] fatal", err);
        frappe.msgprint({ title: __("Pivot Error"), message: __("Unable to open Pivot UI. See console."), indicator: "red" });
      }
    });
    $btn.addClass("frappe-pivot-btn");
  }

  function ensureKeepAlive() {
    if (__pivotKeepAlive) clearInterval(__pivotKeepAlive);
    __pivotKeepAlive = setInterval(() => {
      try {
        if (!onQueryReportRoute()) return clearInterval(__pivotKeepAlive);
        const page = frappe.query_report?.page;
        if (!page) return;
        const toolbar = page.inner_toolbar || page.wrapper?.find?.(".page-actions");
        if (!toolbar?.length) return;
        if (!toolbar.find(".frappe-pivot-btn").length) addButton(frappe.query_report);
      } catch (e) { console.warn("[pivot] keepalive", e); }
    }, 700);
  }

  // ---------- deps ----------
  async function ensureDeps() {
    await injectCSSWithFallback("/assets/pivot_table/js/lib/pivottable/pivot.min.css",
      "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.css");
    if (!(window.jQuery && $.ui && $.ui.sortable && $.ui.draggable && $.ui.droppable)) {
      await injectJSWithFallback("/assets/pivot_table/js/lib/jquery-ui.min.js",
        "https://cdn.jsdelivr.net/npm/jquery-ui@1.13.2/dist/jquery-ui.min.js");
    }
    if (!(window.jQuery && $.fn && $.fn.pivotUI)) {
      await injectJSWithFallback("/assets/pivot_table/js/lib/pivottable/pivot.min.js",
        "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/pivot.min.js");
    }
    if (!window.Plotly) {
      await injectJSWithFallback("/assets/pivot_table/js/lib/plotly-latest.min.js",
        "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js");
    }
    if (!($.pivotUtilities && $.pivotUtilities.plotly_renderers)) {
      await injectJSWithFallback("/assets/pivot_table/js/lib/pivottable/plotly_renderers.min.js",
        "https://cdn.jsdelivr.net/npm/pivottable@2.23.0/dist/plotly_renderers.min.js");
    }
    try {
      const u = $.pivotUtilities || {};
      $.pivotUtilities.renderers = $.extend({}, u.renderers || {}, u.plotly_renderers || {});
    } catch {}

    console.log("[pivot] deps", {
      hasJQ: !!window.jQuery,
      hasUI: !!(window.jQuery && $.ui && $.ui.sortable),
      hasPivot: !!(window.jQuery && $.fn && $.fn.pivotUI),
      hasPlotly: !!window.Plotly
    });
  }
  function injectCSSWithFallback(localHref, cdnHref) {
    return new Promise((resolve) => {
      if (document.querySelector(`link[href="${localHref}"]`) || document.querySelector(`link[href="${cdnHref}"]`)) return resolve();
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = localHref;
      link.onload = () => resolve();
      link.onerror = () => { const fb = document.createElement("link"); fb.rel="stylesheet"; fb.href=cdnHref; fb.onload=()=>resolve(); fb.onerror=()=>resolve(); document.head.appendChild(fb); };
      document.head.appendChild(link);
    });
  }
  function injectJSWithFallback(localSrc, cdnSrc) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${localSrc}"]`) || document.querySelector(`script[src="${cdnSrc}"]`)) return resolve();
      const s = document.createElement("script"); s.src = localSrc; s.onload = () => resolve();
      s.onerror = () => { const f = document.createElement("script"); f.src = cdnSrc; f.onload = () => resolve(); f.onerror = (e) => reject(e); document.head.appendChild(f); };
      document.head.appendChild(s);
    });
  }

  // ---------- main ----------
  async function openPivot(report) {
    const dlg = new frappe.ui.Dialog({ title: DIALOG_TITLE, size: "extra-large" });
    dlg.$body.css({ padding: 0 });

    const $wrap = $(`
      <div style="padding:12px;">
        <div id="pivot-toolbar" style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
          <input id="pivot-preset-name" class="input-with-feedback form-control" placeholder="${__("Preset name")}" style="max-width:220px;">
          <label style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" id="pivot-share"> ${__("Share (public)")}
          </label>
          <button class="btn btn-sm btn-primary" id="pivot-save">${__("Save Preset")}</button>
          <select id="pivot-presets" class="input-with-feedback form-control" style="max-width:300px;">
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
        (report.get_values && report.get_values()) || {};

      log(__("Running report…"));
      const { message } = await frappe.call({
        method: "frappe.desk.query_report.run",
        type: "POST",
        args: { report_name, filters },
      });

      const cols = message?.columns || [];
      const rows = message?.result || message?.values || [];
      if (!cols.length) { log(__("No columns returned from the report.")); return; }
      if (!rows.length) { log(__("No data returned for the current filters.")); return; }

      let sliced = rows, clipped = false;
      if (rows.length > MAX_ROWS) { sliced = rows.slice(0, MAX_ROWS); clipped = true; }

      const labels = cols.map((c, i) => c.label || c.fieldname || `Col ${i + 1}`);
      let data;
      if (Array.isArray(sliced[0])) {
        data = sliced.map((r) => { const o = {}; labels.forEach((k, i) => (o[k] = r[i])); return o; });
      } else if (sliced[0] && typeof sliced[0] === "object") {
        data = sliced.map((obj) => { const o = {}; labels.forEach((lbl, i) => { const c = cols[i]; const key = c.fieldname || c.label || Object.keys(obj)[i]; o[lbl] = obj[key]; }); return o; });
      } else { log(__("Unexpected data format from report.")); return; }

      let numericKeys = cols
        .map((c, i) => ({ key: labels[i], ft: String(c.fieldtype || "").toLowerCase() }))
        .filter((x) => ["float", "currency", "int", "percent", "duration"].includes(x.ft))
        .map((x) => x.key);

      if (!numericKeys.length && data.length) {
        const sample = data[0];
        numericKeys = Object.keys(sample).filter((k) => isNumericLike(sample[k]));
      }

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

      const STORE_KEY = `__pivot_cfg__${report_name}`;
      const saved = tryJSON(localStorage.getItem(STORE_KEY)) || {};
      const defaults = {
        rows: saved.rows?.length ? saved.rows : (dimKeys[0] ? [dimKeys[0]] : []),
        cols: saved.cols?.length ? saved.cols : (dimKeys[1] ? [dimKeys[1]] : []),
        vals: saved.vals?.length ? saved.vals : (numericKeys[0] ? [numericKeys[0]] : []),
        aggregatorName: saved.aggregatorName || (numericKeys.length ? "Sum" : "Count"),
        rendererName: saved.rendererName || "Table",
      };

      // --- presets (server + fallback) ---
      const presetAPI = makePresetAPI(report_name);
      await refreshPresetDropdownServer($("#pivot-presets"), presetAPI);

      $("#pivot-save").on("click", async () => {
        const name = ($("#pivot-preset-name").val() || "").trim();
        const pub = $("#pivot-share")[0].checked ? 1 : 0;
        if (!name) return frappe.msgprint(__("Give this preset a name."));
        const cfg = currentPivotConfig(STORE_KEY);
        await presetAPI.save(name, cfg, pub);
        await refreshPresetDropdownServer($("#pivot-presets"), presetAPI);
        frappe.show_alert({ message: __("Preset saved"), indicator: "green" });
      });

      $("#pivot-delete").on("click", async () => {
        const docname = $("#pivot-presets").val();
        const mine = await presetAPI.isMine(docname);
        if (!docname) return;
        if (!mine) return frappe.msgprint(__("You can only delete your own preset."));
        await presetAPI.delete(docname);
        await refreshPresetDropdownServer($("#pivot-presets"), presetAPI);
        frappe.show_alert({ message: __("Preset deleted"), indicator: "orange" });
      });

      $("#pivot-presets").on("change", async function () {
        const docname = $(this).val();
        if (!docname) return;
        const cfg = await presetAPI.load(docname);
        if (!cfg) return;
        renderPivot(cfg);
      });

      // derived date fields
      $("#pivot-derive").on("click", () => {
        const dateCols = guessDateColumns(data, labels);
        if (!dateCols.length) return frappe.msgprint(__("No obvious date columns found."));
        const derived = buildDateDerivers(dateCols);
        renderPivot(null, derived);
        frappe.show_alert({ message: __("Derived date fields added"), indicator: "blue" });
      });

      // export CSV
      $("#pivot-export").on("click", () => {
        const $tbl = $("#pivot-target table.pvtTable");
        if (!$tbl.length) return frappe.msgprint(__("Switch to a table renderer to export CSV."));
        const csv = tableToCSV($tbl[0]);
        downloadBlob(csv, `${report_name.replace(/\s+/g, "_")}_pivot.csv`, "text/csv;charset=utf-8;");
      });

      // fullscreen
      $("#pivot-fullscreen").on("click", () => {
        const el = dlg.$wrapper[0];
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else el.requestFullscreen?.();
      });

      // first render
      renderPivot(defaults);

      function renderPivot(cfgOverrides, derivedAttrs) {
        const cfg = Object.assign({
          rows: defaults.rows, cols: defaults.cols, vals: defaults.vals,
          aggregatorName: defaults.aggregatorName, rendererName: defaults.rendererName,
          derivedAttributes: Object.assign({}, (derivedAttrs || {})),
          rendererOptions: {
            table: {
              rowTotals: true, colTotals: true,
              clickCallback: (e, value, filters, pivotData) => {
                const rows = []; pivotData.forEachMatchingRecord(filters, (record) => rows.push(record));
                showDrilldown(rows);
              }
            }
          },
          onRefresh: function (cfg2) {
            const clean = { ...cfg2 }; delete clean.rendererOptions; delete clean.localeStrings;
            try { localStorage.setItem(STORE_KEY, JSON.stringify(clean)); } catch {}
          }
        }, cfgOverrides || {});
        $("#pivot-target").pivotUI(data, cfg, true);
      }

    } catch (e) {
      console.error("[pivot] render error", e);
      log(__("Pivot failed: {0}", [String(e?.message || e)]));
    }
  }

  // ----- server preset API with local fallback -----
  function makePresetAPI(report_name) {
    // cache from last list_presets
    let cache = { mine: [], public: [] };

    async function list() {
      try {
        const r = await frappe.call("pivot_table.api.pivot_presets.list_presets", { report_name });
        cache = r.message || { mine: [], public: [] };
        return cache;
      } catch {
        // fallback to local
        const all = tryJSON(localStorage.getItem(PRESET_NS)) || {};
        const map = all[report_name] || {};
        return { mine: Object.keys(map).map(k => ({ name: k, preset_name: k, owner: "local", public: 0 })), public: [] };
      }
    }

    async function save(preset_name, cfg, publicFlag) {
      const config_json = JSON.stringify(cfg || {});
      try {
        await frappe.call("pivot_table.api.pivot_presets.save_preset", { report_name, preset_name, config_json, public: publicFlag, overwrite: 1 });
      } catch {
        // local fallback
        const all = tryJSON(localStorage.getItem(PRESET_NS)) || {};
        all[report_name] = all[report_name] || {};
        all[report_name][preset_name] = cfg;
        localStorage.setItem(PRESET_NS, JSON.stringify(all));
      }
    }

    async function load(nameOrKey) {
      // nameOrKey is DocName (server) or preset key (local)
      try {
        const r = await frappe.call("pivot_table.api.pivot_presets.load_preset", { name: nameOrKey });
        const cfg = tryJSON(r.message?.config_json);
        return cfg || null;
      } catch {
        const all = tryJSON(localStorage.getItem(PRESET_NS)) || {};
        const map = all[report_name] || {};
        return map[nameOrKey] || null;
      }
    }

    async function del(nameOrKey) {
      try {
        await frappe.call("pivot_table.api.pivot_presets.delete_preset", { name: nameOrKey });
      } catch {
        const all = tryJSON(localStorage.getItem(PRESET_NS)) || {};
        if (all[report_name]) { delete all[report_name][nameOrKey]; localStorage.setItem(PRESET_NS, JSON.stringify(all)); }
      }
    }

    async function isMine(docname) {
      if (!docname) return false;
      // if local fallback key, it's "mine"
      if (!docname.includes("-") || docname === "local") return true;
      // find in cache
      if (!cache.mine.length && !cache.public.length) await list();
      return !!cache.mine.find(x => x.name === docname);
    }

    return { list, save, load, delete: del, isMine };
  }

  async function refreshPresetDropdownServer($sel, api) {
    const res = await api.list();
    const mine = res.mine || [];
    const pub = res.public || [];
    const current = $sel.val() || "";
    $sel.empty().append(`<option value="">${__("Load preset…")}</option>`);
    if (mine.length) {
      $sel.append(`<optgroup label="${__("Mine")}">`);
      mine.forEach(x => $sel.append(`<option value="${frappe.utils.escape_html(x.name)}">${frappe.utils.escape_html(x.preset_name)}</option>`));
      $sel.append(`</optgroup>`);
    }
    if (pub.length) {
      $sel.append(`<optgroup label="${__("Public")}">`);
      pub.forEach(x => $sel.append(`<option value="${frappe.utils.escape_html(x.name)}">${frappe.utils.escape_html(x.preset_name)} ${__("(by {0})", [x.owner])}</option>`));
      $sel.append(`</optgroup>`);
    }
    $sel.val(current);
  }

  // ---------- utilities ----------
  function isNumericLike(v) { if (typeof v === "number") return true; if (typeof v !== "string") return false; const n = parseFloat(v.replace(/[^\d.-]/g, "")); return !isNaN(n); }
  function tryJSON(s) { try { return JSON.parse(s || ""); } catch { return null; } }

  function guessDateColumns(data, labels) {
    const maxCheck = Math.min(50, data.length), dateish = new Set();
    for (const lbl of labels) {
      let score = 0;
      for (let i = 0; i < maxCheck; i++) { const d = new Date(data[i][lbl]); if (!isNaN(d)) score++; }
      if (score >= Math.ceil(maxCheck * 0.4)) dateish.add(lbl);
    }
    return Array.from(dateish);
  }
  function buildDateDerivers(dateCols) {
    const out = {}, Q = (m) => "Q" + (Math.floor(m/3)+1);
    dateCols.forEach((col) => {
      out[`${col} (Year)`]    = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : d.getFullYear(); };
      out[`${col} (Quarter)`] = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : Q(d.getMonth()); };
      out[`${col} (Month)`]   = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : (d.getMonth()+1).toString().padStart(2,"0"); };
      out[`${col} (Day)`]     = (r) => { const d = new Date(r[col]); return isNaN(d) ? null : d.getDate().toString().padStart(2,"0"); };
    });
    return out;
  }

  function showDrilldown(rows) {
    if (!rows?.length) return frappe.msgprint(__("No matching rows for this cell."));
    const dlg = new frappe.ui.Dialog({ title: __("Drill-down"), size: "extra-large" });
    const keys = Object.keys(rows[0] || {});
    const head = `<thead><tr>${keys.map(k => `<th>${frappe.utils.escape_html(k)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${rows.map(r => `<tr>${keys.map(k => `<td style="white-space:nowrap;">${frappe.utils.escape_html(String(r[k] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>`;
    dlg.$body.html(`<div style="overflow:auto; max-height:70vh;"><table class="table table-bordered table-compact">${head}${body}</table></div>`);
    dlg.show();
  }

  function tableToCSV(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll("tr")) {
      const cells = [];
      for (const td of tr.querySelectorAll("th,td")) {
        let txt = td.innerText.replace(/\r?\n|\r/g, " ").trim();
        if (txt.includes('"') || txt.includes(",") || txt.includes("\n")) txt = '"' + txt.replace(/"/g, '""') + '"';
        cells.push(txt);
      }
      rows.push(cells.join(","));
    }
    return rows.join("\n");
  }
  function downloadBlob(content, name, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
})();
