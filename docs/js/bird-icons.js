/**
 * ============================================================================
 *  BIRD ICONS  —  a small silhouette beside each species, by body shape
 * ============================================================================
 *  Field guides show a silhouette so you can tell a wader from a warbler at a
 *  glance. Every one of AviList's 250 families is given one of about 30 body
 *  shapes (birdShape_), and each shape is drawn from a few numbers (SHAPES):
 *  body, head, bill, tail, legs. One drawing function (birdIconSvg_) turns
 *  those numbers into an SVG silhouette, so every icon shares one style.
 *
 *  Pure functions: no page code, so they are tested with `node --test`
 *  (Tests/birdIcons.test.js checks every family has an icon).
 *
 *  Drawings face right, in a 24 x 24 box, ground at y = 22, and use
 *  currentColor, so the page's CSS decides their colour.
 */

// ---------------------------------------------------------------------------
//  1. Families -> shapes. The order decides most; some families differ.
// ---------------------------------------------------------------------------
const ORDER_SHAPE_ = {
  Struthioniformes: 'ratite', Casuariiformes: 'ratite', Rheiformes: 'ratite', Apterygiformes: 'kiwi',
  Tinamiformes: 'gamebird', Anseriformes: 'duck', Galliformes: 'gamebird', Phoenicopteriformes: 'flamingo',
  Podicipediformes: 'diver', Musophagiformes: 'longtail', Otidiformes: 'crane', Cuculiformes: 'longtail',
  Mesitornithiformes: 'rail', Pterocliformes: 'pigeon', Columbiformes: 'pigeon', Opisthocomiformes: 'gamebird',
  Gruiformes: 'rail', Charadriiformes: 'wader', Eurypygiformes: 'heron', Phaethontiformes: 'seabird',
  Gaviiformes: 'diver', Sphenisciformes: 'penguin', Procellariiformes: 'seabird', Ciconiiformes: 'crane',
  Suliformes: 'cormorant', Pelecaniformes: 'heron', Caprimulgiformes: 'nightjar', Steatornithiformes: 'nightjar',
  Nyctibiiformes: 'nightjar', Podargiformes: 'nightjar', Aegotheliformes: 'nightjar', Apodiformes: 'swift',
  Strigiformes: 'owl', Cathartiformes: 'raptor', Accipitriformes: 'raptor', Coliiformes: 'longtail',
  Leptosomiformes: 'kingfisher', Trogoniformes: 'longtail', Bucerotiformes: 'bigbill', Coraciiformes: 'kingfisher',
  Piciformes: 'kingfisher', Cariamiformes: 'crane', Falconiformes: 'raptor', Psittaciformes: 'parrot',
  Passeriformes: 'songbird',
};

const FAMILY_SHAPE_ = {
  // Gruiformes
  Gruidae: 'crane', Aramidae: 'ibis', Psophiidae: 'gamebird', Heliornithidae: 'diver',
  // Charadriiformes
  Laridae: 'gull', Stercorariidae: 'gull', Alcidae: 'auk', Turnicidae: 'gamebird', Thinocoridae: 'gamebird',
  Chionidae: 'pigeon', Jacanidae: 'rail',
  // Suliformes
  Fregatidae: 'seabird', Sulidae: 'seabird',
  // Pelecaniformes
  Threskiornithidae: 'ibis', Pelecanidae: 'pelican', Balaenicipitidae: 'crane',
  // Apodiformes
  Trochilidae: 'hummingbird',
  // Bucerotiformes: hoopoes and wood hoopoes are slim, not big-billed
  Upupidae: 'longtail', Phoeniculidae: 'longtail',
  // Coraciiformes
  Momotidae: 'longtail',
  // Piciformes
  Picidae: 'woodpecker', Ramphastidae: 'bigbill', Semnornithidae: 'bigbill',
  // Passeriformes
  Corvidae: 'crow', Artamidae: 'crow', Corcoracidae: 'crow', Paradisaeidae: 'crow', Ptilonorhynchidae: 'crow',
  Platylophidae: 'crow', Buphagidae: 'crow',
  Hirundinidae: 'swallow',
  Fringillidae: 'finch', Estrildidae: 'finch', Ploceidae: 'finch', Viduidae: 'finch', Passeridae: 'finch',
  Emberizidae: 'finch', Passerellidae: 'finch', Calcariidae: 'finch', Cardinalidae: 'finch', Thraupidae: 'finch',
  Paradoxornithidae: 'finch', Urocynchramidae: 'finch',
  Menuridae: 'longtail', Mimidae: 'longtail', Aegithalidae: 'longtail', Rhipiduridae: 'longtail', Dicruridae: 'longtail',
  Sittidae: 'woodpecker', Certhiidae: 'woodpecker', Climacteridae: 'woodpecker', Tichodromidae: 'woodpecker',
  Salpornithidae: 'woodpecker', Neosittidae: 'woodpecker',
};

/**
 * Which body shape a family is drawn as.
 * @param {string} family  AviList family, scientific name (e.g. "Corvidae")
 * @param {string} order   its order (e.g. "Passeriformes")
 * @return {string} a key of SHAPES
 */
function birdShape_(family, order) {
  return FAMILY_SHAPE_[family] || ORDER_SHAPE_[order] || 'songbird';
}

// ---------------------------------------------------------------------------
//  2. Shapes, each described by a few numbers
// ---------------------------------------------------------------------------
// body:  [cx, cy, rx, ry, tilt in degrees]           head: [cx, cy, r]
// bill:  [length, angle (down +), thickness, droop]  neck: [width] joins body to head
// tail:  [[x, y], ...] a point list from the rump    legs: [[x1, y1, x2, y2], ...]
// extra: hand-drawn paths for what numbers can't say (wings, crests, water, perch)
const SHAPES = {
  songbird:    { label: 'Songbird', body: [10.5, 14, 5.4, 3.5, -18], head: [15.6, 10.2, 2.7], bill: [2.6, 6, 1.4, 0],
                 tail: [[6.4, 15.6], [1.5, 19.2], [2.6, 20.2], [7.6, 17]], legs: [[10, 17.2, 9.6, 21.5], [12, 17, 12.4, 21.5]] },
  finch:       { label: 'Finch', body: [10.3, 14.2, 5.4, 3.7, -15], head: [15.4, 10.4, 3], bill: [3.2, 10, 3.4, 0.3],
                 tail: [[6.2, 15.8], [1.8, 18.6], [2.8, 19.8], [7.4, 17.2]], legs: [[9.8, 17.5, 9.4, 21.5], [11.8, 17.3, 12.2, 21.5]] },
  longtail:    { label: 'Long-tailed perching bird', body: [12.5, 11.5, 4.8, 3, -25], head: [17, 7.6, 2.4], bill: [2.8, 10, 1.3, 0.4],
                 tail: [[8.6, 13.4], [1.5, 21.2], [3, 21.8], [10, 14.6]], legs: [[12, 14.2, 11.6, 18], [13.6, 13.8, 14, 18]],
                 extra: ['<path d="M7 18h12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  crow:        { label: 'Crow', body: [10.6, 13, 6.4, 4, -14], head: [17, 8.8, 2.9], bill: [3.8, 10, 2, 0.5],
                 tail: [[5.2, 14.8], [1, 18.2], [2, 19.6], [6.6, 16.6]], legs: [[10, 16.6, 9.4, 21.5], [12.2, 16.4, 12.8, 21.5]] },
  swallow:     { label: 'Swallow', body: [11.5, 13, 5.6, 2.6, -14], head: [16.6, 9.8, 2.3], bill: [1.6, 8, 1.4, 0],
                 tail: [[7, 14.2], [1, 17], [5.2, 15.8], [2.4, 19.6], [7.8, 15.6]], legs: [[11.6, 15.4, 11.4, 18], [13, 15.2, 13.2, 18]],
                 extra: ['<path d="M6 18h13" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  swift:       { label: 'Swift', extra: [
                 '<path d="M1.5 8.5Q7.5 9.4 11 12.4Q14.6 9.4 22.5 7.6Q16.4 12.6 12.6 15Q9.2 12.8 1.5 8.5Z"/>',
                 '<ellipse cx="12.2" cy="14" rx="3.6" ry="1.7" transform="rotate(-12 12.2 14)"/>',
                 '<path d="M9 15l-3.4 2.6 3-0.4 0.8 1.6 1.4-2.6Z"/>'] },
  hummingbird: { label: 'Hummingbird', body: [11.2, 14, 4.2, 2.3, -42], head: [14.4, 9.8, 2.1], bill: [6.6, 6, 0.9, 0],
                 tail: [[9, 16.6], [6.4, 21.4], [8.2, 20.2], [9.2, 21.8], [10.6, 17.4]],
                 extra: ['<path d="M12.4 11.8Q6.8 9.4 3.6 3.6Q8.6 4.4 11.4 7.2Q13.4 9.2 13.8 10.8Z"/>',          // near wing, swept up
                         '<path d="M13.2 10.8Q11.8 6.4 12 1.8Q14.8 4.6 15.2 8.2Q15.2 9.8 14.4 10.8Z" opacity="0.75"/>'] },  // far wing
  woodpecker:  { label: 'Woodpecker', body: [12.4, 12.8, 2.9, 6, 12], head: [14.2, 5.6, 2.5], bill: [3.4, 0, 1.6, 0],
                 tail: [[11, 18], [10.2, 22.4], [11.8, 22.4], [12.8, 18.4]],
                 extra: ['<path d="M18 1v22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>',
                         '<path d="M14.6 10.4l2.6-0.6M14.8 15l2.4 0.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  kingfisher:  { label: 'Kingfisher', body: [10.8, 12.6, 4.4, 3.6, -38], head: [14.6, 7.6, 3.1], bill: [5.6, 8, 2, 0],
                 tail: [[8, 15.4], [6.6, 19.8], [8.2, 20], [9.6, 16]], legs: [[11, 15.8, 11, 18], [12.4, 15.4, 12.4, 18]],
                 extra: ['<path d="M5 18h13" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  bigbill:     { label: 'Hornbill or toucan', body: [9.4, 12.4, 5, 3.8, -28], head: [13.4, 7.6, 2.8], bill: [8, 14, 3.6, 0.8],
                 tail: [[6, 14.4], [2.4, 20.6], [4, 21.2], [7.6, 15.8]], legs: [[9.6, 15.8, 9.6, 19], [11, 15.4, 11, 19]],
                 extra: ['<path d="M4 19h12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  parrot:      { label: 'Parrot', body: [11, 11.6, 3.7, 5.6, 16], head: [13.2, 5.6, 3], bill: [2.6, 40, 2.6, 1.2],
                 tail: [[9, 16], [6.4, 22.4], [8.4, 22.6], [10.8, 16.8]], legs: [[11.6, 16.6, 12.4, 18.6]],
                 extra: ['<path d="M8 18.6h10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  owl:         { label: 'Owl', body: [12, 14.4, 5.2, 6.6, 0], head: [12, 7.4, 4.6],
                 tail: [[10.4, 20.4], [11, 22.4], [13, 22.4], [13.6, 20.4]],
                 extra: ['<path d="M8.4 4.4L7.6 1.2 10.6 3.4Z M15.6 4.4L16.4 1.2 13.4 3.4Z"/>',
                         '<circle cx="10.2" cy="7.4" r="1.2" class="eye"/><circle cx="13.8" cy="7.4" r="1.2" class="eye"/>',
                         '<path d="M12 8.6l-0.8 1.2h1.6Z" class="eye"/>'] },
  pigeon:      { label: 'Pigeon or dove', body: [10.6, 14.4, 6.2, 4, -10], head: [16.6, 9.8, 2.3], neck: 3.2, bill: [1.9, 12, 1.1, 0],
                 tail: [[5, 15.2], [1.2, 16.2], [1.6, 17.6], [5.6, 17.2]], legs: [[10.4, 18.2, 10.2, 21.5], [12, 18, 12.4, 21.5]] },
  gamebird:    { label: 'Gamebird', body: [11, 14.6, 6.2, 4.6, -6], head: [16.8, 9.2, 2.4], neck: 3.4, bill: [1.9, 20, 1.6, 0.3],
                 tail: [[5.2, 13.4], [2, 9], [3.6, 8.6], [6.4, 12.4]], legs: [[10, 18.8, 9.6, 22], [12.4, 18.8, 12.8, 22]] },
  duck:        { label: 'Duck, goose or swan', body: [10.6, 15.8, 7.4, 3.3, -3], head: [16.6, 9.8, 2.6], neck: 2.8, bill: [3.4, 12, 1.8, 0],
                 tail: [[3.8, 15.4], [2, 12.8], [5, 14]],
                 extra: ['<path d="M1.5 19.8h21" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>'] },
  diver:       { label: 'Grebe or loon', body: [10.4, 16.6, 7.2, 2.6, -2], head: [17.2, 10.6, 2], neck: 2.2, bill: [3.6, 6, 1.3, 0],
                 tail: [[3.4, 16.4], [2.6, 15.2], [4.8, 15.4]],
                 extra: ['<path d="M1.5 19.6h21" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>'] },
  penguin:     { label: 'Penguin', body: [11.6, 13.6, 4.2, 7.6, 6], head: [12.8, 5.4, 2.8], bill: [2.8, 14, 1.4, 0],
                 legs: [[10.4, 20.6, 9.4, 22.2], [12.6, 20.8, 13.6, 22.2]],
                 extra: ['<path d="M14.6 11.6Q17.6 15 16.6 18.4Q15 15.6 13.8 13.6Z"/>'] },
  seabird:     { label: 'Seabird', extra: [
                 '<path d="M12 11.6Q13.6 8.8 16 7.4Q18.6 5.6 21.8 3.4Q19.6 7.4 17 9.6Q15.2 11.2 14.6 12.4Z" opacity="0.75"/>',  // far wing, raised
                 '<ellipse cx="11.5" cy="13" rx="5.6" ry="2.4" transform="rotate(-6 11.5 13)"/>',    // body
                 '<path d="M6.6 12.6L3 11.8L3.4 14.6L6.8 14.2Z"/>',                                  // tail
                 '<circle cx="17.2" cy="11.6" r="2.2"/>',                                             // head
                 '<path d="M19.2 10.9L22.2 11.6Q22.7 12.1 22.1 12.5L19.2 12.4Z"/>',                 // bill, small hook at the tip
                 '<path d="M9.4 13.6Q8.6 16 6.6 17.8Q4.6 19.6 2 20.8Q5.6 21 8.6 19Q11 17.4 12.6 14.4Z"/>'] },  // near wing, lowered below the body
  gull:        { label: 'Gull or tern', body: [10.8, 13.4, 6.2, 3.3, -6], head: [16.6, 9.8, 2.5], neck: 2.6, bill: [3.2, 8, 1.4, 0.3],
                 tail: [[5, 13.2], [1, 13.4], [1.4, 14.6], [5.6, 15.4]], legs: [[10.6, 16.4, 10.4, 21.5], [12.2, 16.2, 12.6, 21.5]] },
  auk:         { label: 'Auk or puffin', body: [11.4, 14.6, 3.9, 5.8, 10], head: [13.2, 7.6, 2.8], bill: [2.8, 6, 2.6, 0.4],
                 tail: [[9.8, 19.4], [8.6, 21], [10.6, 20.6]], legs: [[11.4, 20, 11.2, 22], [12.8, 19.8, 13.4, 22]] },
  wader:       { label: 'Wader', body: [9.8, 12.2, 5, 3, -12], head: [14.6, 9.2, 2.1], bill: [5.2, 18, 0.9, 0],
                 tail: [[5.2, 12.8], [2.6, 13.4], [5.6, 14.4]], legs: [[9.4, 14.8, 8.6, 22], [11, 14.6, 12.2, 22]] },
  heron:       { label: 'Heron or egret', body: [8.6, 11.6, 4.6, 2.8, -24], head: [15.4, 4, 1.7],
                 bill: [5.4, 8, 1.2, 0], tail: [[4.6, 13.4], [2.4, 15.4], [5.4, 14.6]],
                 legs: [[8.6, 13.8, 8, 22], [9.8, 13.6, 10.8, 22]],
                 extra: ['<path d="M11.6 10Q14.8 9.6 13.4 7Q12.2 4.6 15 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'] },
  ibis:        { label: 'Ibis or spoonbill', body: [8.6, 11.8, 4.8, 3, -14], head: [14.4, 7.4, 1.7], neck: 1.8, bill: [5.4, 34, 1.1, 1.6],
                 tail: [[4.2, 12.6], [2.2, 13.8], [4.8, 14.4]], legs: [[8.6, 14.4, 8, 22], [10, 14.2, 11, 22]] },
  crane:       { label: 'Crane or stork', body: [9.2, 11.8, 5.2, 3.2, -10], head: [14.6, 3.6, 1.8], neck: 1.8, bill: [4.2, 22, 1.4, 0],
                 tail: [[4.6, 12], [2.2, 14.6], [3.2, 15.4], [6, 14]], legs: [[9.2, 14.8, 8.6, 22], [10.6, 14.6, 11.6, 22]] },
  flamingo:    { label: 'Flamingo', body: [8.8, 11.4, 4.8, 2.8, -10], head: [13.8, 4.2, 1.6],
                 bill: [2.6, 60, 1.3, 0.8], tail: [[4.4, 11.6], [2.6, 12.8], [4.8, 13.2]],
                 legs: [[9, 14, 9, 22], [9.6, 13.8, 12.4, 17.6]],
                 extra: ['<path d="M12.6 10.6Q16.4 8.2 13 6.6Q11.6 5.6 13.4 4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
                         '<path d="M12.4 17.6L9.8 18.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  pelican:     { label: 'Pelican', body: [9.4, 14.4, 6.6, 4.2, -8], head: [15, 7.8, 2.2], neck: 2.4, bill: [7, 10, 1.4, 0],
                 tail: [[3.2, 14], [1.4, 15.4], [3.6, 16.4]], legs: [[9.4, 18.4, 9, 22], [11.2, 18.2, 11.8, 22]],
                 extra: ['<path d="M15.6 9.2Q18.4 13.6 22 9.4L21.6 9.2Q18.6 10.2 16.4 8.4Z"/>'] },
  cormorant:   { label: 'Cormorant', body: [10.2, 13.8, 3.6, 6, 24], head: [14.6, 4.8, 1.9], neck: 2.2, bill: [3.6, 6, 1.3, 0.5],
                 tail: [[7.4, 18.4], [5.4, 22], [7, 22.2], [8.8, 19]], legs: [[11, 19.2, 11, 22]],
                 extra: ['<path d="M5 22.2h12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>'] },
  raptor:      { label: 'Bird of prey', extra: [
                 // a soaring eagle from below: left half drawn, right half mirrored, so it is symmetrical
                 '<path d="M12 8.8C9.4 8.2 5.4 8.4 1.2 9.8L2.6 10.6L0.8 11.4L2.6 11.8L1.2 12.8L3.2 12.8L2.4 14L4.4 13.6L4.2 14.8Q8.4 15.4 12 14.8Z"/>',
                 '<path d="M12 8.8C9.4 8.2 5.4 8.4 1.2 9.8L2.6 10.6L0.8 11.4L2.6 11.8L1.2 12.8L3.2 12.8L2.4 14L4.4 13.6L4.2 14.8Q8.4 15.4 12 14.8Z" transform="matrix(-1 0 0 1 24 0)"/>',
                 '<ellipse cx="12" cy="12.4" rx="2" ry="4.4"/>',                                     // body
                 '<circle cx="12" cy="7.6" r="1.8"/>',                                                // head
                 '<path d="M11.2 6.6L12 4.6L12.8 6.6Z"/>',                                            // bill
                 '<path d="M10.4 15.6L9 20.2Q12 21.2 15 20.2L13.6 15.6Z"/>'] },                       // fanned tail
  ratite:      { label: 'Ostrich, emu or rhea', body: [8.4, 10.4, 6, 4, -6], head: [15.6, 2.8, 1.6], neck: 1.6, bill: [2, 10, 1.1, 0],
                 tail: [[2.6, 9.4], [1, 8.4], [2.4, 11.6]], legs: [[8.4, 13.6, 8, 22], [10.4, 13.4, 11.6, 22]] },
  kiwi:        { label: 'Kiwi', body: [10.4, 14.4, 6.6, 4.8, -4], head: [16, 11.2, 2.4], bill: [5.6, 50, 1, 0.8],
                 legs: [[9.6, 18.6, 9.4, 22], [11.6, 18.6, 12, 22]] },
  nightjar:    { label: 'Nightjar or relative', body: [10.4, 14.4, 6.6, 2.7, -8], head: [16.4, 11.6, 3.1], bill: [1.4, 12, 1.8, 0],
                 tail: [[4.4, 15.2], [0.6, 17.2], [1.2, 18.4], [5.4, 16.8]],
                 extra: ['<path d="M1.5 18.8h21" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',  // branch
                         '<path d="M9.4 16.8L9.4 18.8M12 16.6L12 18.8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'] },
  rail:        { label: 'Rail, crake or coot', body: [10.6, 13.6, 5, 3.8, -12], head: [15.4, 9.6, 2.2], bill: [2.6, 14, 1.4, 0],
                 tail: [[6.2, 13.2], [4.6, 10.6], [6, 10.6], [7.4, 12.4]], legs: [[10.2, 17, 9.4, 21.5], [11.8, 16.8, 12.8, 21.5]],
                 extra: ['<path d="M7.6 21.6h3M11 21.6h3.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>'] },
};

// ---------------------------------------------------------------------------
//  3. Drawing
// ---------------------------------------------------------------------------
const r1_ = n => Math.round(n * 10) / 10;

/** The bill: a tapered wedge from the head's edge, drooping by `droop` at the tip. */
function billPath_(head, bill) {
  const [hx, hy, hr] = head, [len, ang, thick, droop] = bill;
  const a = ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
  const bx = hx + dx * hr * 0.85, by = hy + dy * hr * 0.85;          // base, just inside the head
  const tx = bx + dx * len, ty = by + dy * len + droop;              // tip
  const mx = (bx + tx) / 2 + px * droop * 0.5, my = (by + ty) / 2 + py * droop * 0.5 - droop * 0.3;
  const h = thick / 2;
  return 'M' + r1_(bx + px * h) + ' ' + r1_(by + py * h) +
    'Q' + r1_(mx + px * h * 0.5) + ' ' + r1_(my + py * h * 0.5) + ' ' + r1_(tx) + ' ' + r1_(ty) +
    'Q' + r1_(mx - px * h * 0.5) + ' ' + r1_(my - py * h * 0.5) + ' ' + r1_(bx - px * h) + ' ' + r1_(by - py * h) + 'Z';
}

/**
 * The SVG for one shape (a string). Filled silhouettes in currentColor;
 * elements with class "eye" are meant to be painted in the background colour.
 * @param {string} shape  a key of SHAPES (unknown keys draw a songbird)
 * @param {number} [size] width and height in px (default 22)
 */
function birdIconSvg_(shape, size) {
  const s = SHAPES[shape] || SHAPES.songbird, px = size || 22, out = [];
  if (s.body) {
    const [cx, cy, rx, ry, tilt] = s.body;
    out.push('<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '"' +
      (tilt ? ' transform="rotate(' + tilt + ' ' + cx + ' ' + cy + ')"' : '') + '/>');
  }
  if (s.tail) out.push('<path d="M' + s.tail.map(p => p.join(' ')).join('L') + 'Z"/>');
  if (s.neck && s.body && s.head) {
    const [cx, cy, rx, , tilt] = s.body, a = (tilt || 0) * Math.PI / 180;
    const fx = cx + Math.cos(a) * rx * 0.7, fy = cy + Math.sin(a) * rx * 0.7 - 0.6;   // front of the body
    out.push('<path d="M' + r1_(fx) + ' ' + r1_(fy) + 'L' + s.head[0] + ' ' + s.head[1] +
      '" fill="none" stroke="currentColor" stroke-width="' + s.neck + '" stroke-linecap="round"/>');
  }
  if (s.head) out.push('<circle cx="' + s.head[0] + '" cy="' + s.head[1] + '" r="' + s.head[2] + '"/>');
  if (s.bill && s.head) out.push('<path d="' + billPath_(s.head, s.bill) + '"/>');
  (s.legs || []).forEach(([x1, y1, x2, y2]) => out.push('<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 +
    '" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>'));
  (s.extra || []).forEach(e => out.push(e));
  return '<svg class="bird-icon" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" aria-hidden="true" focusable="false">' +
    out.join('') + '</svg>';
}
