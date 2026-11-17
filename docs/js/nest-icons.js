/**
 * ============================================================================
 *  NEST ICONS  —  a small drawing beside each nest type
 * ============================================================================
 *  One line drawing for each of BIRDBASE's nest types (the "nest" field, from
 *  tools/build-traits.js), in the same style as habitat-icons.js: a 24 x 24 box,
 *  currentColor, so the page's CSS decides the colour. "No nest" and "Other
 *  bird's nest" have no drawing (they describe behaviour, not a structure).
 *
 *  Pure: tested with `node --test` (Tests/birdIcons.test.js checks every
 *  nest type in docs/data/traits.json has a drawing, apart from those two).
 */

const NEST_ICONS_ = {
  Cup: { label: 'Cup: a deep, woven bowl', art:
    '<path d="M4 9.5h16c0 5.2-3.6 8.5-8 8.5s-8-3.3-8-8.5Z"/><path d="M6.2 12.5h11.6M7.8 15.2h8.4"/>' +
    '<path d="M4.5 9.5 3 7.8M19.5 9.5l1.6-2"/><path d="M12 18v4M12 20.2 8.5 22M12 20.2l3.5 1.6"/>' },
  'Tree cavity': { label: 'Tree cavity: a hole in a trunk', art:
    '<path d="M7.5 2v20M16.5 2v20"/><circle cx="12" cy="9.5" r="2.6"/><path d="M16.5 15 21 12.5"/>' +
    '<path d="M9.5 15.5v2.5M14 4v2.5"/><path d="M3 22h18"/>' },
  Sphere: { label: 'Sphere: a woven ball with a side entrance', art:
    '<path d="M4 3h16M12 3v1.5"/><circle cx="12" cy="12" r="7.5"/><circle cx="14.6" cy="13" r="1.9"/>' +
    '<path d="M6.3 9.5c3 1.3 7.5 1.3 11.4 0M5.6 15c1.6.8 3.2 1.1 4.8 1.1"/>' },
  Platform: { label: 'Platform: a flat pile of sticks', art:
    '<path d="M3 12.5h18M4.5 10.8l14 .7M5.5 14.2l13-.6M7 9.3l10 .5M3.5 13.4l3-2.2M20.5 13.5l-2.8-2.4"/>' +
    '<path d="M12 14.5V22M12 18.6 8.2 16M12 18.6l3.8-2.6"/>' },
  Scrape: { label: 'Scrape: a dip in the ground', art:
    '<path d="M2 15h4c1.8 4.2 10.2 4.2 12 0h4"/><ellipse cx="9.4" cy="15.4" rx="1.7" ry="1.3"/>' +
    '<ellipse cx="14.6" cy="15.6" rx="1.7" ry="1.3"/><circle cx="3.8" cy="13.4" r=".7"/><circle cx="20.3" cy="13.5" r=".7"/>' },
  Dome: { label: 'Dome: covered, with a front entrance', art:
    '<path d="M2 20h20"/><path d="M4 20c0-10.5 16-10.5 16 0"/><path d="M9.5 20v-3a2.5 2.5 0 0 1 5 0v3"/>' +
    '<path d="M6.5 14.5c1-1 2-1.6 3-1.9M17.5 14.5c-1-1-2-1.6-3-1.9"/>' },
  Burrow: { label: 'Burrow: a tunnel into a bank', art:
    '<path d="M2 7h20"/><path d="M4.5 7c.8 5.8 5.5 8.4 9.4 9.4M7.5 7c.8 3.8 3.6 5.9 7 6.4"/><circle cx="17" cy="15.5" r="3.3"/>' +
    '<path d="M3 3.5l1.2 2M8 3l.8 2.5M20 3.5l-.8 2.2"/>' },
  Pendant: { label: 'Pendant: a woven bag hanging from a branch', art:
    '<path d="M3 3h18"/><path d="M12 3c-3.8 0-5 6-5 10.5 0 4.6 2.2 7.5 5 7.5s5-2.9 5-7.5C17 9 15.8 3 12 3Z"/>' +
    '<circle cx="12" cy="18.6" r="1.4"/><path d="M8 9.5c2.6.8 5.4.8 8 0M7.3 13.5c3.1.8 6.3.8 9.4 0"/>' },
  'Half cup': { label: 'Half cup: a shallow bowl on a wall', art:
    '<path d="M19 2v20"/><path d="M19 10H8c0 4 4.2 6 11 6"/><path d="M10.5 12.7H19M13 14.8h6"/><path d="M21 6v2M21 15v2"/>' },
  Crevice: { label: 'Crevice: tucked into a gap in rock', art:
    '<path d="M2 3h6l1.2 6-2 5.5L9 21H2Z"/><path d="M22 3h-5.8l-1.4 5.5 2.2 6-2 6.5H22Z"/>' +
    '<path d="M9.6 14.2h5c0 1.9-1.1 2.9-2.5 2.9s-2.5-1-2.5-2.9Z"/><path d="M4 7.5h2M18 10h2M4 17h2"/>' },
  Mound: { label: 'Mound: a heap of earth and leaves', art:
    '<path d="M2 20h20"/><path d="M3 20c2-7.8 6-11 9-11s7 3.2 9 11"/><ellipse cx="8.4" cy="17.4" rx="1.3" ry="1"/>' +
    '<ellipse cx="12" cy="17.6" rx="1.3" ry="1"/><ellipse cx="15.6" cy="17.4" rx="1.3" ry="1"/>' +
    '<path d="M12 9V6.8M10 9.4 8.8 7.6M14 9.4l1.2-1.8M6 13.2 4.3 12.4M18 13.2l1.7-.8"/>' },
  Saucer: { label: 'Saucer: a flat, thin dish', art:
    '<path d="M3 11h18c-1.5 2.6-5 3.6-9 3.6S4.5 13.6 3 11Z"/><path d="M2.5 18 21.5 16M9.5 17.4 7.5 21"/>' },
};

// Where a nest is (BIRDBASE's nest site), shown when the nest type isn't recorded
const NEST_SITE_ICONS_ = {
  Tree: { label: 'In trees', art: '<path d="M12 21V12"/><path d="M12 13c-4.6 0-7-2.6-7-5.6S7.7 2.5 12 2.5s7 2 7 4.9-2.4 5.6-7 5.6Z"/><path d="M12 16l-3-2.4M12 15l2.6-1.8"/><path d="M5 21h14"/>' },
  Ground: { label: 'On the ground', art: '<path d="M2 14h20"/><path d="M4 17.5h4M11 18.5h4.5M18 17.5h3M6 21h3M14 21.5h3"/><path d="M5 14v-3.5M7 14v-2.5M17 14v-3M19 14v-2"/><ellipse cx="12" cy="12.6" rx="2" ry="1.4"/>' },
  Shrub: { label: 'In shrubs', art: '<path d="M3 20c-1-3 1-5 3-5 0-3 3-4 5-2.5C12 10 16 10 17 13c3-1 5 2 4 5"/><path d="M8 20l1-4M14 20l-1-4"/><path d="M1 20h22"/>' },
  Rock: { label: 'On rock', art: '<path d="M2 20l3.5-8 4 2 3-6.5 4.5 5 2.5-1.5L22 20Z"/><path d="M9.5 14l1.2 3M15.5 12.5l-1 3"/>' },
  Grass: { label: 'In grass', art: '<path d="M4 20c0-4-1-7-2-9M4 20c0-4 1-7 3-9M12 20c0-5-1-8-2-11M12 20c0-5 1-8 2.5-11M20 20c0-4-1-6-2-8M20 20c0-3 1-6 3-8"/><path d="M1 20h22"/>' },
  Building: { label: 'On buildings', art: '<path d="M3 21V10l9-6.5 9 6.5v11"/><path d="M16 6.4V3.5h2.5v4.7"/><path d="M10 21v-5.5h4V21"/><path d="M1.5 21h21"/>' },
  Stump: { label: 'In stumps', art: '<path d="M6 21V11M18 21V11"/><ellipse cx="12" cy="11" rx="6" ry="2.2"/><path d="M12 11c1.4 0 2.4-.4 2.4-.9s-1-.9-2.4-.9-2.4.4-2.4.9"/><path d="M3 21h18M6 17l-2.5 4M18 17l2.5 4"/>' },
  'Other animal\'s nest': { label: 'In other animals\' nests (e.g. termite mounds)', art: '<path d="M4 21c1-6 2.5-10 4-13 .8-1.6 1.6-3.5 2.5-5 1 1.6 1.4 3.3 2 4.6 1.2-1.3 2.2-1.6 2.8-1 1.6 3.5 3 8.8 3.7 14.4Z"/><circle cx="11.5" cy="14" r="1.3"/><path d="M2 21h20"/>' },
  Bamboo: { label: 'In bamboo', art: '<path d="M7 21V3M12 21V2M17 21V4"/><path d="M5.8 8h2.4M5.8 14h2.4M10.8 6h2.4M10.8 12h2.4M10.8 18h2.4M15.8 9h2.4M15.8 15h2.4"/>' },
  Pole: { label: 'On poles', art: '<path d="M12 21V3"/><path d="M5 6h14M7 6v2M17 6v2"/><path d="M9 21h6"/>' },
  Water: { label: 'On water', art: '<path d="M7.5 12.5h9c0 2-2 3.4-4.5 3.4s-4.5-1.4-4.5-3.4Z"/><path d="M1 17c2-1.5 4-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0 3.5 1.5 5.5 0"/><path d="M3 20.5c2-1.2 3.5-1.2 5.5 0s3.5 1.2 5.5 0 3.5-1.2 5.5 0"/>' },
  Cactus: { label: 'In cacti', art: '<path d="M10 21V5a2 2 0 0 1 4 0v16"/><path d="M10 13H7.5A1.5 1.5 0 0 1 6 11.5V9M14 11h2.5a1.5 1.5 0 0 0 1.5-1.5V7"/><path d="M4 21h16"/>' },
};

/** The drawing for a nest site as an SVG string, or '' for one with none. */
function nestSiteIconSvg_(site, size) {
  const n = NEST_SITE_ICONS_[site];
  if (!n) return '';
  return '<svg class="nest-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false"' +
    ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + n.art + '</svg>';
}

/** The drawing for a nest type as an SVG string, or '' for a type with none. */
function nestIconSvg_(nest, size) {
  const n = NEST_ICONS_[nest];
  if (!n) return '';
  return '<svg class="nest-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false"' +
    ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + n.art + '</svg>';
}
