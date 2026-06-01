// XML generation.
//
// Each valid data row is converted to a complete XML document conforming to the
// CDN Post-TX Exchange schema (xmlns="urn:cdn:pdx:v1").
//
// The approach uses the browser's built-in DOMParser and XMLSerializer rather
// than string concatenation, which guarantees well-formed output and handles
// special characters in field values automatically (e.g. "&" → "&amp;").
//
// Field positions within the XML are described using an XPath-like notation
// stored in COLUMN_CONFIG[n].xpath. See setXPathValue() for the supported
// syntax. All paths are relative to the <Publication> element.

import { COLUMN_CONFIG } from '../config.js';
import { log } from './debug.js';

const NS = 'urn:cdn:pdx:v1';

// ---------------------------------------------------------------------------
// Write a value at an XPath-like location within the <Publication> element.
//
// Supported notation (all paths relative to the <Publication> element):
//
//   @attr
//     Set an attribute on <Publication> itself.
//     e.g. "@publicationId" → <Publication publicationId="value" …>
//
//   ChildElement
//     Create a child element with text content.
//     e.g. "PublicationDateTime" → <PublicationDateTime>value</PublicationDateTime>
//
//   Parent/Child/@attr
//     Navigate into (or create) intermediate elements, then set an attribute.
//     e.g. "ChannelPlatforms/ChannelPlatform/@label"
//
//   Parent/Child/Element[n]/@attr
//     Zero-based indexed repeated element. Creates siblings as needed.
//     e.g. "ChannelPlatforms/ChannelPlatform/SubChannel[0]/@label" for the
//     first sub-channel, SubChannel[1] for the second, etc.
//
// Values that are null, undefined, or empty string are silently ignored —
// the XML element or attribute is simply not created.
// ---------------------------------------------------------------------------
function setXPathValue(doc, pubEl, xpath, value) {
  if (value === null || value === undefined || value === '') return;

  const parts = xpath.split('/');
  let current = pubEl; // start navigation from <Publication>

  for (let i = 0; i < parts.length; i++) {
    const part   = parts[i];
    const isLast = i === parts.length - 1;

    // --- Attribute: @attrName ---
    if (part.startsWith('@')) {
      current.setAttribute(part.slice(1), value);
      return;
    }

    // --- Indexed element: TagName[n] ---
    const indexedMatch = part.match(/^([A-Za-z]+)\[(\d+)\]$/);
    if (indexedMatch) {
      const tagName  = indexedMatch[1];
      const idx      = parseInt(indexedMatch[2], 10); // zero-based
      // Collect all existing siblings with this tag name
      const siblings = Array.from(current.children).filter(c => c.tagName === tagName);
      // Create missing siblings until we reach index idx
      while (siblings.length <= idx) {
        const el = doc.createElementNS(NS,tagName);
        current.appendChild(el);
        siblings.push(el);
      }
      current = siblings[idx]; // navigate into the indexed element
      continue;
    }

    if (isLast) {
      // Final path segment (not an attribute) — create child element with text
      const el = doc.createElementNS(NS,part);
      el.textContent = value;
      current.appendChild(el);
      return;
    }

    // --- Intermediate path segment: navigate into or create the child element ---
    let el = Array.from(current.children).find(c => c.tagName === part);
    if (!el) {
      el = doc.createElementNS(NS,part);
      current.appendChild(el);
    }
    current = el;
  }
}

// ---------------------------------------------------------------------------
// Generate a complete XML document string for one resolved data row.
//
// resolvedFields: { fieldName: xmlReadyString | null }
//   Produced by validation.js; dates are already ISO 8601, booleans are
//   "true"/"false" strings, nulls mean "omit this field".
//
// Sub-channel rule: a SubChannel element is only emitted when the corresponding
// label field has a value. This prevents empty <SubChannel> stubs in the output.
// ---------------------------------------------------------------------------
export function generateXML(resolvedFields) {
  // Start with a minimal valid document containing an empty <Publication>
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<?xml version="1.0" encoding="UTF-8"?>
<Document schemaVersion="1.0" xmlns="urn:cdn:pdx:v1">
  <Publications>
    <Publication/>
  </Publications>
</Document>`,
    'application/xml'
  );

  const pubEl = doc.querySelector('Publication');

  for (const field of COLUMN_CONFIG) {
    const { fieldName, xpath } = field;
    const value = resolvedFields[fieldName];

    if (!value) continue; // null/undefined/empty — omit from XML

    // Sub-channel guard: only create SubChannel[n] elements when the label
    // for that sub-channel is present. This applies to both label and id fields.
    const subMatch = xpath.match(/SubChannel\[(\d+)\]/);
    if (subMatch) {
      const idx      = parseInt(subMatch[1], 10);
      const labelKey = `Sub-channel ${idx + 1} Label`;
      // If the label for this sub-channel slot is empty, skip the ID too
      if (!resolvedFields[labelKey]) continue;
    }

    setXPathValue(doc, pubEl, xpath, value);
  }

  // SubChannel is mandatory on every ChannelPlatform (v1 schema).
  // If no sub-channel data was provided in the spreadsheet, inject a default
  // core network entry. If sub-channels were provided, mark the first one
  // as the core feed via isCore="true".
  const cpEl = pubEl.querySelector('ChannelPlatform');
  if (cpEl) {
    const subChannels = Array.from(cpEl.getElementsByTagName('SubChannel'));
    if (subChannels.length === 0) {
      const sc = doc.createElementNS(NS,'SubChannel');
      sc.setAttribute('label', 'Network');
      sc.setAttribute('isCore', 'true');
      cpEl.appendChild(sc);
    } else {
      subChannels[0].setAttribute('isCore', 'true');
    }
  }

  const serializer = new XMLSerializer();
  const xmlString  = serializer.serializeToString(doc);
  log('Generated XML:', xmlString.slice(0, 200));
  return xmlString;
}

// ---------------------------------------------------------------------------
// Open a new browser window and render all generated XML strings as formatted
// HTML for inspection. Only called when ?debug=true is in the URL.
//
// This lets developers verify the XML output before any upload happens,
// without needing to upload to S3 or inspect network traffic.
// ---------------------------------------------------------------------------
export function previewXML(xmlStrings) {
  const win = window.open('', '_blank');
  if (!win) return; // popup may be blocked by the browser

  // Build one <pre> block per row
  const items = xmlStrings
    .map(
      (xml, i) =>
        `<h3 style="margin:16px 0 4px;color:#555">Row ${i + 1}</h3>
<pre style="background:#f4f4f4;padding:12px;border-radius:4px;overflow-x:auto;font-size:12px">${escapeHtml(xml)}</pre>`
    )
    .join('');

  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TEP XML Preview</title>
<style>body{font-family:monospace;padding:24px;max-width:900px;margin:auto}</style>
</head><body><h2>XML Preview (${xmlStrings.length} rows)</h2>${items}</body></html>`
  );
  win.document.close();
}

// Escape HTML special characters so XML can be displayed safely inside <pre> tags
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
