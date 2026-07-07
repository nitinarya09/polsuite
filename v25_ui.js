/* v24_ui.js — v2.4 UI Polish  (fix-2: progress + DDO placement)
   Deployed: build_v24_external.py pipeline
   Key fixes:
     - Progress bar: no longer self-triggers from its own text nodes
     - DDO Chart: inserted as real DOM sibling in nav tab bar, not float
*/
(function () {
'use strict';

/* ------------------------------------------------------------------ */
/*  Logging                                                             */
/* ------------------------------------------------------------------ */
var LOG = [];
function log(m) { LOG.push(m); try { console.log('[v24]', m); } catch (e) {} }
log('v24_ui.js start');

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
function $A(sel, root) {
  try { return Array.from((root || document).querySelectorAll(sel)); }
  catch (e) { return []; }
}
function deb(fn, ms) {
  var t;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}

/* ------------------------------------------------------------------ */
/*  1.  Head CSS (React-proof)                                          */
/* ------------------------------------------------------------------ */
function injectHeadCSS() {
  if (document.getElementById('v24-head-css')) return;
  var s = document.createElement('style');
  s.id = 'v24-head-css';
  s.textContent = [

    /* === Progress bar — hidden by default === */
    '#v24-prog{position:fixed;top:0;left:0;right:0;z-index:99999;',
    'background:rgba(13,17,23,.97);border-bottom:1px solid rgba(99,102,241,.3);',
    'display:none;flex-direction:column;padding:4px 14px 5px;gap:3px;}',
    '#v24-prog.on{display:flex;}',
    '#v24-prog-lbl{font-size:10px;color:#94a3b8;',
    'display:flex;justify-content:space-between;align-items:center;}',
    '#v24-prog-track{width:100%;height:4px;background:rgba(255,255,255,.1);',
    'border-radius:2px;overflow:hidden;}',
    '#v24-prog-fill{height:100%;width:0%;border-radius:2px;',
    'background:linear-gradient(90deg,#6366f1,#06b6d4,#10b981);',
    'background-size:200% 100%;transition:width .3s;',
    'animation:v24sh 2s linear infinite;}',
    '@keyframes v24sh{0%{background-position:200% 0}100%{background-position:-200% 0}}',

    /* === Amber Run button (fixed overlay beside POL) === */
    '#v24-run{position:fixed;z-index:9500;',
    'background:linear-gradient(135deg,#f59e0b,#d97706);',
    'color:#0d1117;font-weight:800;font-size:13px;',
    'padding:8px 16px;border-radius:9px;border:none;cursor:pointer;',
    'box-shadow:0 3px 14px rgba(245,158,11,.5);transition:all .15s;',
    'display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit;}',
    '#v24-run:hover{transform:translateY(-1px);box-shadow:0 5px 18px rgba(245,158,11,.6);}',
    '#v24-run:disabled{opacity:.35;cursor:not-allowed;transform:none;}',

    /* === Checklist: upgrade 3-col → auto-fill === */
    '.lg\\:grid-cols-3{',
    'grid-template-columns:repeat(auto-fill,minmax(185px,1fr))!important;',
    'gap:5px!important;}',

    /* === Compact card padding === */
    '.bg-\\[\\#1e2336\\]{padding:8px 10px!important;}',

    /* === Triage card highlight (T1-T5) === */
    '.v24-triage{border-left:3px solid #818cf8!important;',
    'background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.07))!important;}',

    /* === Results table sort/filter === */
    '.v24-th-s{cursor:pointer!important;user-select:none!important;}',
    '.v24-th-s:hover{background:rgba(99,102,241,.12)!important;}',
    '.v24-srt-ic{font-size:10px;margin-left:3px;opacity:.35;transition:opacity .12s;}',
    '.v24-th-s.asc .v24-srt-ic,.v24-th-s.desc .v24-srt-ic{opacity:1;color:#6366f1;}',
    '.v24-frow td{padding:2px 3px!important;background:rgba(99,102,241,.05)!important;}',
    '.v24-finp{width:100%!important;box-sizing:border-box!important;',
    'background:rgba(255,255,255,.06)!important;',
    'border:1px solid rgba(99,102,241,.25)!important;',
    'border-radius:4px!important;color:#e2e8f0!important;',
    'font-size:11px!important;padding:2px 5px!important;outline:none!important;}',
    '.v24-finp:focus{border-color:rgba(99,102,241,.55)!important;}',
    '.v24-rcnt{font-size:10px;color:#64748b;padding:2px 6px 3px;text-align:right;}',

    /* === DDO slide-in panel === */
    '#v24-ddo{position:fixed;top:0;right:-430px;width:420px;bottom:0;',
    'background:rgba(13,17,23,.98);border-left:1px solid rgba(99,102,241,.3);',
    'z-index:97000;display:flex;flex-direction:column;',
    'transition:right .28s cubic-bezier(.4,0,.2,1);backdrop-filter:blur(8px);}',
    '#v24-ddo.open{right:0;}',
        'padding:13px 15px;border-bottom:1px solid rgba(255,255,255,.07);',
    'font-weight:700;font-size:13px;color:#e2e8f0;}',
                '.v24-drow{display:flex;align-items:center;gap:7px;margin-bottom:4px;cursor:pointer;}',
    '.v24-drow:hover .v24-dbar{filter:brightness(1.3);}',
    '.v24-dlbl{font-size:10px;color:#cbd5e1;width:130px;flex-shrink:0;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.v24-dtrk{flex:1;background:rgba(255,255,255,.07);height:13px;border-radius:3px;overflow:hidden;}',
    '.v24-dbar{height:100%;border-radius:3px;',
    'background:linear-gradient(90deg,#6366f1,#06b6d4);transition:width .35s;}',
    '.v24-dval{font-size:10px;color:#94a3b8;width:60px;text-align:right;flex-shrink:0;}',

    /* === DDO Chart tab button (inside nav bar) === */
        'color:#fff!important;border-color:transparent!important;}',
        'transform:translateY(-1px);}',

    /* === Load indicator badge === */
    '#v24-ind{position:fixed;bottom:6px;left:6px;z-index:99998;',
    'background:rgba(99,102,241,.85);color:#fff;font-size:10px;font-weight:700;',
    'padding:3px 9px;border-radius:5px;pointer-events:none;font-family:monospace;}'

  ].join('');
  (document.head || document.documentElement).appendChild(s);
  log('head CSS injected');
}

/* ------------------------------------------------------------------ */
/*  2.  Progress bar  (FIXED: no self-trigger)                         */
/* ------------------------------------------------------------------ */
function setupProgressBar() {
  if (document.getElementById('v24-prog')) return;
  var w = document.createElement('div');
  w.id = 'v24-prog';
  /* Note: start with EMPTY text so we don't self-trigger */
  w.innerHTML = '<div id="v24-prog-lbl">'
    + '<span id="v24-prog-txt"></span>'
    + '<span id="v24-prog-pct"></span>'
    + '</div>'
    + '<div id="v24-prog-track"><div id="v24-prog-fill"></div></div>';
  document.body.insertBefore(w, document.body.firstChild);

  new MutationObserver(deb(syncProgress, 150))
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  log('progress bar created');
}

function syncProgress() {
  var wrap = document.getElementById('v24-prog');
  var fill = document.getElementById('v24-prog-fill');
  var txt  = document.getElementById('v24-prog-txt');
  var pct  = document.getElementById('v24-prog-pct');
  if (!wrap) return;

  var found = null;
  var progEl = wrap; /* reference to exclude from search */

  /* Walk text nodes, SKIP our own #v24-prog subtree */
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      /* Reject if ancestor is our progress bar */
      var p = node.parentNode;
      while (p) {
        if (p === progEl) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);
  var node;
  while ((node = walker.nextNode())) {
    var v = (node.nodeValue || '').trim();
    if (/analyz/i.test(v) && /\d+%/.test(v)) { found = v; break; }
  }

  /* Fallback: element textContent (skip our elements) */
  if (!found) {
    $A('p,span,div').some(function (el) {
      if (wrap.contains(el)) return false; /* skip our elements */
      var t = (el.textContent || '').trim();
      if (/analyz/i.test(t) && /\d+%/.test(t) && t.length < 150) {
        found = t; return true;
      }
      return false;
    });
  }

  if (found) {
    var m = found.match(/(\d+)%/);
    var p = m ? +m[1] : 0;
    /* Only show if there's actual progress (> 0%) */
    if (p > 0) {
      wrap.classList.add('on');
      if (fill) fill.style.width = p + '%';
      if (txt)  txt.textContent  = found.replace(/\d+%/, '').trim() || 'Analyzing…';
      if (pct)  pct.textContent  = p + '%';
      return;
    }
  }
  /* Hide when not analyzing */
  wrap.classList.remove('on');
  if (fill) fill.style.width = '0%';
  if (txt)  txt.textContent  = '';
  if (pct)  pct.textContent  = '';
}

/* ------------------------------------------------------------------ */
/*  3.  Run Analyses amber button (fixed, beside POL dropdown)         */
/* ------------------------------------------------------------------ */
var _polBtn  = null;
var _runSide = null;

function findPOLButton() {
  return $A('button,[role="button"]').find(function (b) {
    var t = (b.textContent || '').trim();
    return t.indexOf('Payment Order List') >= 0
        || (t.indexOf('POL') >= 0 && t.length < 60);
  }) || null;
}

function findRunSidebar() {
  /* The sidebar CA component wraps icon + label text.
     We look for a small element whose text IS "Run Analyses". */
  var all = $A('button,div,li,span,a');
  var found = null;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var t = (el.textContent || '').trim();
    if (t === 'Run Analyses' && el !== document.getElementById('v24-run')) {
      found = el;
      break;
    }
  }
  return found;
}

function setupRunBtn() {
  var existing = document.getElementById('v24-run');
  /* Remove if POL has moved (stale) */
  if (_polBtn && !document.contains(_polBtn)) {
    _polBtn = null;
    if (existing) { existing.remove(); existing = null; }
  }
  if (existing && document.contains(existing)) return true;

  _polBtn  = findPOLButton();
  _runSide = findRunSidebar();
  if (!_polBtn) { log('POL btn not found'); return false; }

  log('POL: ' + _polBtn.textContent.trim().slice(0, 35));
  log('Run sidebar: ' + (_runSide ? _runSide.tagName : 'not found'));

  var btn = document.createElement('button');
  btn.id = 'v24-run';
  btn.innerHTML = '&#9654;&nbsp;Run Analyses';
  btn.title = 'Run selected audit checks on merged data';
  document.body.appendChild(btn);

  function reposition() {
    if (!_polBtn || !document.contains(_polBtn)) return;
    var r = _polBtn.getBoundingClientRect();
    if (!r.width) return;
    var bh = btn.offsetHeight || 36;
    btn.style.top   = Math.round(r.top + (r.height - bh) / 2) + 'px';
    btn.style.right = Math.round(window.innerWidth - r.left + 8) + 'px';
  }
  window.addEventListener('resize', deb(reposition, 80));
  window.addEventListener('scroll', deb(reposition, 40), true);
  [0, 200, 600, 1500, 3000].forEach(function (d) { setTimeout(reposition, d); });

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    _runSide = findRunSidebar();
    if (_runSide) {
      _runSide.click();
      try { _runSide.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); } catch(e2) {}
    }
  });
  return true;
}

/* ------------------------------------------------------------------ */
/*  4.  Checklist: triage highlight (T1-T5)                            */
/* ------------------------------------------------------------------ */
/* CSS already handles grid upgrade via .lg\:grid-cols-3 override.     */
var _chkDone = false;
function applyTriageHighlights() {
  if (_chkDone) return;
  /* Card labels are in <p class="text-xs font-extrabold leading-tight text-white"> */
  var labels = $A('p').filter(function (p) {
    var cls = p.className || '';
    return cls.indexOf('font-extrabold') >= 0 && cls.indexOf('text-xs') >= 0;
  });
  if (!labels.length) labels = $A('p').filter(function (p) {
    return (p.className || '').indexOf('font-extrabold') >= 0;
  });
  var found = 0;
  labels.forEach(function (p) {
    if (/^T[1-5][ ·\-·]/.test((p.textContent || '').trim())) {
      var card = p;
      for (var i = 0; i < 6; i++) {
        card = card && card.parentElement;
        if (!card) break;
        var cls = card.className || '';
        if (cls.indexOf('rounded-xl') >= 0) {
          card.classList.add('v24-triage');
          found++;
          break;
        }
      }
    }
  });
  if (found > 0) { _chkDone = true; log('triage: ' + found); }
}

/* ------------------------------------------------------------------ */
/*  5.  Results table sort + filter                                     */
/* ------------------------------------------------------------------ */
var _enhTbls = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

function enhanceTables() {
  $A('table').forEach(function (tbl) {
    if (_enhTbls && _enhTbls.has(tbl)) return;
    var thead = tbl.querySelector('thead');
    var tbody = tbl.querySelector('tbody');
    if (!thead || !tbody) return;
    var ths = $A('th', thead);
    if (ths.length < 2) return;
    if (_enhTbls) _enhTbls.add(tbl);
    log('table enhanced cols=' + ths.length);

    var ss = { col: -1, dir: 1 };

    ths.forEach(function (th, ci) {
      th.classList.add('v24-th-s');
      var ic = document.createElement('span');
      ic.className = 'v24-srt-ic'; ic.textContent = ' \u2195';
      th.appendChild(ic);
      th.addEventListener('click', function () {
        if (ss.col === ci) ss.dir = -ss.dir; else { ss.col = ci; ss.dir = 1; }
        ths.forEach(function (h, i) {
          h.classList.remove('asc', 'desc');
          var x = h.querySelector('.v24-srt-ic'); if (!x) return;
          if (i === ci) { h.classList.add(ss.dir === 1 ? 'asc' : 'desc'); x.textContent = ss.dir === 1 ? ' \u2191' : ' \u2193'; }
          else x.textContent = ' \u2195';
        });
        var rows = $A('tr', tbody);
        rows.sort(function (a, b) {
          var av = a.cells[ci] ? a.cells[ci].textContent.trim() : '';
          var bv = b.cells[ci] ? b.cells[ci].textContent.trim() : '';
          var an = parseFloat(av.replace(/[, \t]/g, '')), bn = parseFloat(bv.replace(/[, \t]/g, ''));
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * ss.dir;
          return av.localeCompare(bv, 'en-IN', { numeric: true }) * ss.dir;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });

    var fr = document.createElement('tr'); fr.className = 'v24-frow';
    ths.forEach(function () {
      var td = document.createElement('td');
      var inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = 'filter\u2026'; inp.className = 'v24-finp';
      inp.addEventListener('input', deb(function () { doFilter(tbl, tbody, fr); }, 200));
      td.appendChild(inp); fr.appendChild(td);
    });
    thead.appendChild(fr);

    var rc = document.createElement('div'); rc.className = 'v24-rcnt';
    if (tbl.parentElement) tbl.parentElement.insertBefore(rc, tbl);
  });
}

function doFilter(tbl, tbody, fr) {
  var inputs  = $A('.v24-finp', fr);
  var filters = inputs.map(function (i) { return i.value.toLowerCase().trim(); });
  var active  = filters.some(function (f) { return f.length > 0; });
  var vis = 0;
  $A('tr', tbody).forEach(function (row) {
    var show = filters.every(function (f, i) {
      if (!f) return true;
      var c = row.cells[i]; return c && c.textContent.toLowerCase().indexOf(f) >= 0;
    });
    row.style.display = show ? '' : 'none';
    if (show) vis++;
  });
  var rc = tbl.parentElement && tbl.parentElement.querySelector('.v24-rcnt');
  if (rc) rc.textContent = active ? (vis + (vis === 1 ? ' row shown' : ' rows shown')) : '';
}

/* ------------------------------------------------------------------ */
/*  6.  Worker interception (for DDO chart data)                       */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  7.  DDO panel (slide-in)                                           */
/* ------------------------------------------------------------------ */




/* ------------------------------------------------------------------ */
/*  8.  DDO Chart tab button  (DOM-inserted into nav bar)              */
/* ------------------------------------------------------------------ */
/*  The real nav tabs render as:                                        */
/*  <button class="px-4 py-1.5 rounded-lg text-xs font-bold            */
/*    whitespace-nowrap transition-all flex items-center gap-1.5 ..."   */
/*  We match that class signature and insert our button as a sibling.   */


/* ------------------------------------------------------------------ */
/*  9.  Load indicator                                                  */
/* ------------------------------------------------------------------ */
function showIndicator() {
  if (document.getElementById('v24-ind')) return;
  var d = document.createElement('div'); d.id = 'v24-ind'; d.textContent = 'v2.4 UI';
  document.body.appendChild(d);
}

/* ------------------------------------------------------------------ */
/*  10.  Master init                                                    */
/* ------------------------------------------------------------------ */
var _retries = 0;
var _btnOk = false;

function init() {
  try { injectHeadCSS(); }    catch (e) { log('CSS err:' + e); }
  try { showIndicator(); }    catch (e) {}
  try { setupProgressBar(); } catch (e) {}
  try { if (!_btnOk) _btnOk = setupRunBtn(); }  catch (e) { log('run err:' + e); }
  try { applyTriageHighlights(); }  catch (e) {}
  try { enhanceTables(); }          catch (e) {}
  try { setupDDOTab(); }            catch (e) {}
  try { buildDDOPanel(); }          catch (e) {}

  if (!_btnOk && ++_retries < 40) setTimeout(init, 600);
}

/* MutationObserver — re-apply after React re-renders */
new MutationObserver(deb(function () {
  try {
    var btn = document.getElementById('v24-run');
    if (!btn || !document.contains(btn)) _btnOk = false;
    if (!_btnOk) setupRunBtn();
    applyTriageHighlights();
    enhanceTables();
  } catch (e) {}
}, 400)).observe(document.body || document.documentElement, { childList: true, subtree: true });

/* Boot */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
} else {
  setTimeout(init, 0);
}
window.addEventListener('load', function () { setTimeout(init, 400); });
[700, 1500, 2500, 4000, 6000, 9000].forEach(function (ms) { setTimeout(init, ms); });

})();


/* ================================================================== */