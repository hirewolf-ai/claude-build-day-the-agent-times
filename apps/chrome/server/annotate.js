// Port of browser_use/browser/python_highlights.py to Node + sharp.
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// Strategy: receive a PNG screenshot (base64) + the selectorMap from
// get_visible_dom (json format). Build an SVG overlay with one dashed
// bounding box + numbered label per interactive element. Composite via
// sharp. Return the annotated PNG as base64.

const sharp = require("sharp");

// Tag → color, ported from ELEMENT_COLORS.
const ELEMENT_COLORS = {
  button: "#FF6B6B",   // red
  input: "#4ECDC4",    // teal
  select: "#45B7D1",   // blue
  a: "#96CEB4",        // green
  textarea: "#FF8C42", // orange
  default: "#DDA0DD",  // light purple
};

function colorFor(tag, type) {
  if (tag === "input" && (type === "button" || type === "submit")) return ELEMENT_COLORS.button;
  return ELEMENT_COLORS[tag] || ELEMENT_COLORS.default;
}

// XML-escape utility for SVG text content.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build the SVG overlay string.
 *
 * @param nodes  Array of { id, tag, attrs?, bbox: { x, y, w, h }, name? }
 *               from get_visible_dom JSON format. Coordinates are CSS pixels.
 * @param dpr    Device pixel ratio — bbox is in CSS px, screenshot is in
 *               device px, so we scale.
 * @param imgW   Image width (device px)
 * @param imgH   Image height (device px)
 * @param filterShortLabels  If true (default), only draw label when the
 *               element's display name has < 3 chars (matches browser-use's
 *               filter_highlight_ids=true behavior).
 */
function buildOverlaySvg(nodes, dpr, imgW, imgH, filterShortLabels = true) {
  // Font sizing matches python_highlights base_font_size.
  const baseFontSize = Math.max(10, Math.min(20, Math.round(imgW * 0.01)));
  const padding = Math.max(4, Math.min(10, Math.round(imgW * 0.005)));
  const labelHeight = baseFontSize + padding * 2;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" shape-rendering="crispEdges">`,
    // CSS for dashed strokes once.
    `<style>.box{fill:none;stroke-width:2;stroke-dasharray:4 8;}</style>`,
  ];

  for (const n of nodes) {
    if (!n.bbox) continue;
    const x1 = Math.round(n.bbox.x * dpr);
    const y1 = Math.round(n.bbox.y * dpr);
    const x2 = Math.round((n.bbox.x + n.bbox.w) * dpr);
    const y2 = Math.round((n.bbox.y + n.bbox.h) * dpr);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 2 || h < 2) continue;
    // Clip to image bounds.
    if (x2 <= 0 || y2 <= 0 || x1 >= imgW || y1 >= imgH) continue;

    const color = colorFor(n.tag, n.attrs?.type);

    // The dashed bounding box.
    parts.push(
      `<rect class="box" x="${x1}" y="${y1}" width="${w}" height="${h}" stroke="${color}" />`,
    );

    // Decide whether to show the index label.
    const labelText = String(n.id);
    if (filterShortLabels) {
      const name = (n.name || "").trim();
      if (name.length >= 3) continue; // text is descriptive enough; skip the badge
    }

    // Label container width — approximate, monospace digits ~0.6em.
    const textWidth = labelText.length * baseFontSize * 0.6;
    const containerW = Math.round(textWidth + padding * 2);
    const containerH = labelHeight;

    // Position: badge always sits just above the element so it never covers
    // the visible text. Center horizontally.
    let bgX = x1 + Math.round((w - containerW) / 2);
    let bgY = y1 - containerH - 3;
    // If there's no room above, tuck it below instead.
    if (bgY < 0) bgY = Math.min(imgH - containerH, y2 + 3);

    // Clip to image bounds.
    if (bgX < 0) bgX = 0;
    if (bgY < 0) bgY = 0;
    if (bgX + containerW > imgW) bgX = imgW - containerW;
    if (bgY + containerH > imgH) bgY = imgH - containerH;

    const textX = bgX + containerW / 2;
    const textY = bgY + containerH / 2;

    parts.push(
      `<rect x="${bgX}" y="${bgY}" width="${containerW}" height="${containerH}" fill="${color}" stroke="white" stroke-width="2" />`,
      `<text x="${textX}" y="${textY}" font-family="-apple-system,Helvetica,sans-serif" font-size="${baseFontSize}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">${esc(labelText)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Annotate a screenshot.
 *
 * @param screenshotB64  Base64 PNG/JPEG screenshot (no data URL prefix).
 * @param nodes          Array of node objects from get_visible_dom json.
 * @param dpr            Device pixel ratio of the screenshot capture.
 * @param filterShortLabels  See buildOverlaySvg.
 * @returns Base64 PNG of the annotated image.
 */
async function annotateScreenshot(screenshotB64, nodes, dpr = 1, filterShortLabels = true) {
  const screenshotBuf = Buffer.from(screenshotB64, "base64");
  const meta = await sharp(screenshotBuf).metadata();
  const svg = buildOverlaySvg(nodes, dpr, meta.width, meta.height, filterShortLabels);
  const out = await sharp(screenshotBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return out.toString("base64");
}

module.exports = { annotateScreenshot, buildOverlaySvg, ELEMENT_COLORS };
