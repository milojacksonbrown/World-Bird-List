/**
 * ============================================================================
 *  HABITAT ICONS  —  a small drawing beside each habitat in "Ask your list"
 * ============================================================================
 *  One line drawing for each of BIRDBASE's main habitats (the "habitat" field,
 *  from tools/build-traits.js). Drawn in a 24 x 24 box, ground at y = 20, in
 *  currentColor, so the page's CSS decides their colour, like the bird icons.
 *
 *  Pure: tested with `node --test` (Tests/birdIcons.test.js checks every
 *  habitat in docs/data/traits.json has a drawing).
 */

const HABITAT_ICONS_ = {
  Forest: { label: 'Forest', art:
    '<path d="M6 3 2.5 11h7Z M6 8 2 16h8Z"/><path d="M6 16v4"/>' +
    '<path d="M16 2l-4.5 9h9Z M16 7l-5 10h10Z"/><path d="M16 17v3"/><path d="M1 20h22"/>' },
  Woodland: { label: 'Woodland', art:
    '<path d="M8 12c-3 0-4.5-2-4.5-4S5.5 3.5 8 3.5 12.5 5 12.5 8 11 12 8 12Z"/><path d="M8 12v8"/>' +
    '<path d="M18 14c-2 0-3-1.3-3-3s1.2-3 3-3 3 1.4 3 3-1 3-3 3Z"/><path d="M18 14v6"/><path d="M1 20h22"/>' },
  Shrub: { label: 'Shrub and scrub', art:
    '<path d="M3 20c-1-3 1-5 3-5 0-3 3-4 5-2.5C12 10 16 10 17 13c3-1 5 2 4 5"/><path d="M8 20l1-4 M14 20l-1-4"/><path d="M1 20h22"/>' },
  Grassland: { label: 'Grassland', art:
    '<path d="M3 20c0-4-1-7-2-9 M3 20c0-4 1-7 3-9 M3 20c1-3 2-5 4-6"/>' +
    '<path d="M12 20c0-5-1-8-2-11 M12 20c0-5 1-8 2.5-11 M12 20c1-3 2.5-5 4.5-6"/>' +
    '<path d="M20 20c0-4-1-6-2-8 M20 20c0-3 1-6 3-8"/><path d="M1 20h22"/>' },
  Savanna: { label: 'Savanna', art:
    '<path d="M3 8c2-2 13-2 15 0-2 1.5-13 1.5-15 0Z"/><path d="M10.5 9v11 M10.5 13l-3-4 M10.5 12l3.5-3"/>' +
    '<path d="M18 20c0-2-1-3-2-4 M18 20c0-2 1-3 2.5-4"/><path d="M1 20h22"/>' },
  Plains: { label: 'Plains and open country', art:
    '<circle cx="17" cy="7" r="2.5"/><path d="M1 14c4-2 8-2 11 0s8 2 11 0"/><path d="M1 20h22 M4 17h5 M14 17h6"/>' },
  Wetland: { label: 'Wetland', art:
    '<path d="M7 18V5 M12 18V8 M17 18V6"/><path d="M6 5.5a1 2.5 0 1 0 2 0 1 2.5 0 1 0-2 0 M16 6.5a1 2.5 0 1 0 2 0 1 2.5 0 1 0-2 0"/>' +
    '<path d="M1 18c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0 3.5 1.5 5.5 0"/><path d="M3 21.5c2-1.2 3.5-1.2 5.5 0s3.5 1.2 5.5 0 3.5-1.2 5.5 0"/>' },
  Riparian: { label: 'Rivers and streams', art:
    '<path d="M6 10c-2 0-3-1.2-3-3s1.4-3.5 3-3.5S9 5 9 7s-1 3-3 3Z"/><path d="M6 10v6"/>' +
    '<path d="M13 2c-1 3 4 5 2 9s-5 4-4 9"/><path d="M19 2c-1 3 4 5 2 9s-4 5-3 9"/>' },
  Coastal: { label: 'Coast', art:
    '<path d="M1 20c5 0 8-2 10-6s5-7 12-7"/><path d="M14 16c1.5-1 3-1 4.5 0s3 1 4.5 0 M17 20c1.2-.8 2.4-.8 3.6 0"/>' +
    '<circle cx="5" cy="6" r="2.5"/>' },
  Sea: { label: 'Open sea', art:
    '<path d="M1 10c2-2 4-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0 3.5 2 5.5 0"/>' +
    '<path d="M1 15c2-2 4-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0 3.5 2 5.5 0"/>' +
    '<path d="M1 20c2-2 4-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0 3.5 2 5.5 0"/>' },
  Rocky: { label: 'Rocky areas and cliffs', art:
    '<path d="M1 20 5 9l3 3 4-8 4 6 2-2 5 12"/><path d="M8 12l1 4 M14 8l-1 5"/><path d="M1 20h22"/>' },
  Desert: { label: 'Desert', art:
    '<circle cx="18" cy="5" r="2.5"/><path d="M1 20c3-5 7-6 11-3 3-2 7-2 11 1"/><path d="M1 20h22"/>' +
    '<path d="M6 17V9a1.2 1.2 0 0 1 2.4 0v8 M6 13H4.5V11 M8.4 12H10v-2"/>' },
  Bamboo: { label: 'Bamboo', art:
    '<path d="M7 21V3 M12 21V2 M17 21V4"/><path d="M5.8 8h2.4 M5.8 14h2.4 M10.8 6h2.4 M10.8 12h2.4 M10.8 18h2.4 M15.8 9h2.4 M15.8 15h2.4"/>' +
    '<path d="M12 6c2-2 4-2 6-1.5-2 1.5-4 2-6 1.5 M7 11c-2-1.5-4-1.5-5.5-.5 1.5 1 3.5 1.5 5.5.5"/>' },
  Artificial: { label: 'Farms and towns', art:
    '<path d="M2 20V11l5-4.5 5 4.5v9"/><path d="M5.5 20v-4.5h3V20"/>' +
    '<path d="M12 20V8h5v12 M14 11h1 M14 14h1"/><path d="M17 20v-6h5v6"/><path d="M1 20h22"/>' },
};

/** The drawing for a habitat as an SVG string, or '' for a habitat with none. */
function habitatIconSvg_(habitat, size) {
  const h = HABITAT_ICONS_[habitat];
  if (!h) return '';
  return '<svg class="habitat-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false"' +
    ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + h.art + '</svg>';
}
