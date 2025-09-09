// /assets/pivot_table/js/pivot_boot.js
(() => {
  const once = (key, fn) => {
    if (window.__pivot_once__ && window.__pivot_once__[key]) return;
    window.__pivot_once__ = window.__pivot_once__ || {};
    window.__pivot_once__[key] = true;
    fn();
  };

  function routeToPivot(opts) {
    // Adjust to your page name / route and how your pivot page expects options
    // Example: a custom desk page registered as frappe.pages['pivot-table']
    frappe.set_route('pivot-table'); // or: frappe.set_route('pivot-table', opts)
  }

  function patchListView() {
    if (!frappe.views || !frappe.views.ListView) return;
    if (frappe.views.ListView.prototype.__pivot_patched__) return;

    const orig_setup_menu = frappe.views.ListView.prototype.setup_menu;
    frappe.views.ListView.prototype.setup_menu = function () {
      if (orig_setup_menu) orig_setup_menu.apply(this, arguments);

      // avoid duplicates
      if (this.page && !this.page.__pivot_btn_added__) {
        this.page.__pivot_btn_added__ = true;
        this.page.add_menu_item(__('Open Pivot'), () => {
          const ctx = { doctype: this.doctype, view: 'List' };
          routeToPivot(ctx);
        }, /*standard*/ true);
      }
    };

    frappe.views.ListView.prototype.__pivot_patched__ = true;
    console.log('[pivot] ListView patched');
  }

  function patchQueryReport() {
    if (!frappe.views || !frappe.views.QueryReport) return;
    if (frappe.views.QueryReport.prototype.__pivot_patched__) return;

    const orig_setup_menu = frappe.views.QueryReport.prototype.setup_menu;
    frappe.views.QueryReport.prototype.setup_menu = function () {
      if (orig_setup_menu) orig_setup_menu.apply(this, arguments);

      if (this.page && !this.page.__pivot_btn_added__) {
        this.page.__pivot_btn_added__ = true;
        this.page.add_menu_item(__('Open Pivot'), () => {
          let filters = {};
          try { filters = this.get_filter_values ? this.get_filter_values() : {}; } catch (e) {}
          const ctx = { report: this.report_name, filters, view: 'Report' };
          routeToPivot(ctx);
        }, /*standard*/ true);
      }
    };

    frappe.views.QueryReport.prototype.__pivot_patched__ = true;
    console.log('[pivot] QueryReport patched');
  }

  function init() {
    if (!window.frappe) return setTimeout(init, 150);
    once('pivot_patchers', () => {
      patchListView();
      patchQueryReport();
    });

    // In case views are loaded lazily after boot:
    frappe.router && frappe.router.on('change', () => {
      setTimeout(() => {
        try { patchListView(); } catch (_) {}
        try { patchQueryReport(); } catch (_) {}
      }, 0);
    });
  }

  // wait for Desk boot
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
