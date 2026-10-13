/**
 * The measurements the guard tests take.
 *
 * Each probe is a **string** of browser source. `page.evaluate` runs its
 * function in the page, which cannot see this module's scope — passing source
 * keeps the shared `describe()` helper available to every probe instead of
 * copy-pasting it into each one. Each is a self-invoking arrow so the helper
 * declarations and the measurement share one function body.
 */

const HELPERS = `
function describe(el) {
  var tag = el.tagName.toLowerCase();
  var cls = (el.getAttribute("class") || "")
    .split(/\\s+/)
    .filter(function (c) {
      return c && c.indexOf(":") === -1 && c.indexOf("[") === -1 && c.indexOf("!") === -1;
    })
    .slice(0, 3)
    .join(".");
  var text = (el.textContent || "").trim().slice(0, 24);
  return tag + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "") + (text ? ' "' + text + '"' : "");
}
`;

/** Horizontal overflow: the document's, and every element that causes it. */
export const OVERFLOW_PROBE = `(() => {
${HELPERS}
  var de = document.documentElement;
  var viewport = de.clientWidth;
  var offenders = [];
  var all = document.querySelectorAll("body *");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var style = getComputedStyle(el);
    if (style.position === "fixed" && style.pointerEvents === "none") continue;
    if (style.visibility === "hidden" || style.display === "none") continue;
    // Geometry inside an <svg> is in user units and is clipped by its own
    // viewport; it can never scroll the page.
    if (el.ownerSVGElement) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    var scrollable = el.scrollWidth > el.clientWidth + 1 && style.overflowX !== "visible";
    // Anything inside a deliberately scrollable strip lives in that strip's own
    // coordinate space; only the strip's own box can overflow the page.
    var inScroller = false;
    var walk = el.parentElement;
    while (walk && walk !== document.body) {
      if (getComputedStyle(walk).overflowX !== "visible" && walk.scrollWidth > walk.clientWidth + 1) {
        inScroller = true;
        break;
      }
      walk = walk.parentElement;
    }
    if (rect.right > viewport + 1 && !scrollable && !inScroller) {
      offenders.push({
        selector: describe(el),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
    }
  }
  return {
    documentScrollWidth: de.scrollWidth,
    viewport: viewport,
    overflowBy: de.scrollWidth - viewport,
    offenders: offenders.slice(0, 8),
  };
})()`;

/** Controls below 44px, and adjacent controls closer than 8px. */
export const TARGET_PROBE = `(() => {
${HELPERS}
  // Sub-pixel tolerance. Chrome and Firefox lay the same CSS out a fraction of
  // a pixel apart — the same 8px gap-2 gutter measured 8.0000 in Chrome and
  // 7.9964 in Firefox, which failed an 8px-apart rule in one engine only.
  // Every minimum in this app is a whole number of pixels, so a measurement
  // within half a pixel of one is rounding, not design: a 43px control and a
  // 6px gap are still reported.
  var ROUNDING = 0.5;
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var small = [];
  var crowded = [];
  var nodes = document.querySelectorAll(
    'a[href], button, [role="tab"], [role="switch"], input:not([type="hidden"]), select, textarea'
  );
  var controls = [];
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom < 0) continue;
    controls.push(el);
  }

  for (var j = 0; j < controls.length; j++) {
    var c = controls[j];
    var r = c.getBoundingClientRect();
    var cs = getComputedStyle(c);
    // A visually-hidden input is driven by its own label, which is measured
    // itself: .sr-only is a 1x1 box on purpose (WCAG bypass blocks).
    if (c.classList.contains("sr-only") || c.closest(".sr-only")) continue;
    // A control inside a deliberately scrollable strip (the calendar's month
    // grid, a tab row on a phone) is not a mis-tap risk.
    var scroller = c.parentElement;
    while (scroller && scroller !== document.body) {
      if (getComputedStyle(scroller).overflowX !== "visible") break;
      scroller = scroller.parentElement;
    }
    if (scroller && scroller !== document.body) continue;
    // Inline links in a sentence are exempt (WCAG 2.5.8): the target is the
    // text, and the text is what wraps.
    var prose = c.closest("p, li");
    var inlineInProse =
      cs.display.indexOf("inline") === 0 &&
      !!prose &&
      (prose.textContent || "").trim().length > (c.textContent || "").trim().length;
    if (inlineInProse) continue;
    // A checkbox or radio is governed by its label, which is measured itself.
    if (c.matches('input[type="checkbox"], input[type="radio"]')) continue;
    if (r.height < 44 - ROUNDING || r.width < 24 - ROUNDING) {
      small.push({ selector: describe(c), w: round2(r.width), h: round2(r.height) });
    }
  }

  for (var a = 0; a < controls.length; a++) {
    for (var b = a + 1; b < controls.length; b++) {
      var ea = controls[a];
      var eb = controls[b];
      if (ea.contains(eb) || eb.contains(ea)) continue;
      if (ea.parentElement !== eb.parentElement) continue;
      // The gap rule is about *distinct* controls. Two cells of one matrix are
      // not distinct: a calendar's day buttons and the app's tab bars are each
      // a single control surface, separated by alignment and rules rather than
      // by a gutter. Their sizes are still checked above.
      var parent = ea.parentElement;
      if (!parent) continue;
      var pd = getComputedStyle(parent).display;
      if (pd === "grid" || pd === "inline-grid") continue;
      if (parent.tagName === "UL" || parent.closest('[role="tablist"], nav')) continue;
      var ra = ea.getBoundingClientRect();
      var rb = eb.getBoundingClientRect();
      var overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapY <= 2) continue;
      var gap = rb.left > ra.left ? rb.left - ra.right : ra.left - rb.right;
      if (gap >= 0 && gap < 8 - ROUNDING) {
        crowded.push({ a: describe(ea), b: describe(eb), gap: round2(gap) });
      }
    }
  }
  return { small: small, crowded: crowded.slice(0, 10) };
})()`;

/** The strongest note pixel inside each calm pocket, and its text contrast. */
export const CALM_CONTRAST_PROBE = `(() => {
${HELPERS}
  var canvas = document.querySelector("[data-notes-field]");
  if (!canvas) return { error: "no note canvas" };
  var ctx = canvas.getContext("2d");
  if (!ctx) return { error: "no 2d context" };
  var dpr = canvas.width / Math.max(1, canvas.clientWidth);
  var pockets = document.querySelectorAll("[data-notes-calm]");
  var body = getComputedStyle(document.body);
  var pageRgb = body.backgroundColor.match(/\\d+/g);
  if (!pageRgb) return { error: "page has no resolved background colour" };
  var page = pageRgb.map(Number);
  var inkRgb = body.color.match(/\\d+/g);
  if (!inkRgb) return { error: "page has no resolved text colour" };
  var ink = inkRgb.map(Number);

  function luminance(rgb) {
    var parts = rgb.map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }

  var worst = [];
  for (var i = 0; i < pockets.length; i++) {
    var box = pockets[i].getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    var x = Math.max(0, Math.floor(box.left * dpr));
    var y = Math.max(0, Math.floor(box.top * dpr));
    var w = Math.min(canvas.width - x, Math.floor(box.width * dpr));
    var h = Math.min(canvas.height - y, Math.floor(box.height * dpr));
    if (w <= 0 || h <= 0) continue;
    var data;
    try {
      data = ctx.getImageData(x, y, w, h).data;
    } catch (e) {
      return { error: "canvas readback refused: " + e.message };
    }
    var maxAlpha = 0;
    var strongest = [0, 0, 0];
    for (var p = 3; p < data.length; p += 4) {
      if (data[p] > maxAlpha) {
        maxAlpha = data[p];
        strongest = [data[p - 3], data[p - 2], data[p - 1]];
      }
    }
    // getImageData hands back straight RGBA, so composite the strongest note
    // over the page colour — what the eye actually sees behind the text.
    var alpha = maxAlpha / 255;
    var composite = strongest.map(function (c, k) {
      return c * alpha + page[k] * (1 - alpha);
    });
    var l1 = luminance(composite) + 0.05;
    var l2 = luminance(ink) + 0.05;
    worst.push({
      pocket: describe(pockets[i]),
      alpha: Math.round(alpha * 100) / 100,
      contrast: Math.round((Math.max(l1, l2) / Math.min(l1, l2)) * 100) / 100,
    });
  }
  return { worst: worst };
})()`;

/**
 * Does an open surface keep its own children inside it?
 *
 * QA-11 and QA-12 were both "the panel is right and the thing inside it is
 * not": a switch knob painted on the label beside it, and a sheet footer button
 * painted 470px outside the sheet. Neither one is *page* overflow — the body is
 * `overflow: hidden` while a sheet is open — and neither is a size or a spacing
 * problem, so nothing else here has an opinion about it. This probe is that
 * opinion, and it is the reason the interactive surfaces are now measured with
 * the surface **open** rather than only closed.
 *
 * Anything inside a scroll container is skipped: it lives in that container's
 * coordinate space and is clipped by it.
 */
export const CONTAINMENT_PROBE = `(() => {
${HELPERS}
  var dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { found: false };
  var box = dialog.getBoundingClientRect();
  var escapes = [];
  var all = dialog.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (el.ownerSVGElement) continue;
    // Fixed children are anchored to the viewport on purpose, not to the panel.
    if (style.position === "fixed") continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    var clipped = false;
    for (var w = el.parentElement; w && w !== dialog; w = w.parentElement) {
      var ws = getComputedStyle(w);
      if (ws.overflowX !== "visible" || ws.overflowY !== "visible") {
        clipped = true;
        break;
      }
    }
    if (clipped) continue;
    var over = {
      left: Math.round(Math.max(0, box.left - rect.left)),
      right: Math.round(Math.max(0, rect.right - box.right)),
      bottom: Math.round(Math.max(0, rect.bottom - box.bottom)),
    };
    if (over.left > 1 || over.right > 1 || over.bottom > 1) {
      escapes.push({ selector: describe(el), over: over });
    }
  }
  return {
    found: true,
    label: dialog.getAttribute("aria-label"),
    panel: {
      left: Math.round(box.left),
      right: Math.round(box.right),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    escapes: escapes.slice(0, 8),
  };
})()`;

/**
 * Is the switch's knob inside its own track?
 *
 * QA-11: the knob had no horizontal inset, so `left: auto` resolved to its
 * *static* position — 21.4px into a 42px track — and the state travel was added
 * on top of it. The knob ended up painted on the first letter of the label
 * beside it. The control was the right size, in the right place, and every
 * tap-target assertion passed.
 */
export const SWITCH_PROBE = `(() => {
${HELPERS}
  var sw = document.querySelector('[role="switch"]');
  if (!sw) return { found: false };
  var track = sw.firstElementChild;
  if (!track) return { found: false };
  var knob = track.firstElementChild;
  if (!knob) return { found: false };
  var t = track.getBoundingClientRect();
  var k = knob.getBoundingClientRect();
  var label = sw.getAttribute("aria-label");
  var overlapping = [];
  // Anything that carries the same label text, i.e. the visible label beside it.
  var all = document.querySelectorAll("body span, body p, body label");
  for (var i = 0; i < all.length; i++) {
    var other = all[i];
    if (other === track || other === knob || other.contains(knob)) continue;
    if (!label || (other.textContent || "").trim().slice(0, 40) !== label.slice(0, 40)) continue;
    var o = other.getBoundingClientRect();
    if (o.width === 0) continue;
    var overlapX = Math.min(k.right, o.right) - Math.max(k.left, o.left);
    var overlapY = Math.min(k.bottom, o.bottom) - Math.max(k.top, o.top);
    if (overlapX > 0.5 && overlapY > 0.5) {
      overlapping.push({ selector: describe(other), overlapX: Math.round(overlapX) });
    }
  }
  return {
    found: true,
    label: label,
    checked: sw.getAttribute("aria-checked") === "true",
    track: { left: Math.round(t.left), right: Math.round(t.right), width: Math.round(t.width), height: Math.round(t.height) },
    knob: { left: Math.round(k.left), right: Math.round(k.right), width: Math.round(k.width), height: Math.round(k.height) },
    knobInsideTrack:
      k.left >= t.left - 0.5 && k.right <= t.right + 0.5 && k.top >= t.top - 0.5 && k.bottom <= t.bottom + 0.5,
    overlappingLabels: overlapping,
    transition: getComputedStyle(knob).transitionProperty,
  };
})()`;

/** Any element still running a perceptible animation, for reduced motion. */
export const ANIMATION_PROBE = `(() => {
${HELPERS}
  var bad = [];
  var all = document.querySelectorAll("body *");
  for (var i = 0; i < all.length; i++) {
    var style = getComputedStyle(all[i]);
    if (style.animationName === "none") continue;
    var longest = 0;
    var parts = style.animationDuration.split(",");
    for (var p = 0; p < parts.length; p++) {
      var seconds = parseFloat(parts[p]) || 0;
      if (seconds > longest) longest = seconds;
    }
    if (longest > 0.05) {
      bad.push({
        selector: describe(all[i]),
        animation: style.animationName,
        duration: style.animationDuration,
      });
    }
  }
  return bad.slice(0, 10);
})()`;
