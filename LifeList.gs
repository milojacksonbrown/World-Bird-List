/**
 * ============================================================================
 *  MY WORLD BIRD LIST  —  Google Sheets + AviList + eBird
 * ============================================================================
 *
 *  What this script does
 *  ---------------------
 *  • Downloads the AviList global checklist (every bird species on Earth) and
 *    builds these tabs: Start Here, Summary, Families, Genera, Species,
 *    eBird Data, Name Fixes, Taxonomy Log.
 *  • Reads your eBird "Download My Data" file and fills in Status, Lifer Date,
 *    Lifer Location and subspecies/forms for every species you've logged.
 *  • Colour-codes species, genera and families so you can see at a glance
 *    which ones you've seen.
 *  • Runs once a day by itself: picks up any new eBird file you've dropped
 *    into the Drive folder, and every ~6 months checks AviList for a new
 *    version (your own notes, statuses and photo links are kept).
 *
 *  ONE-TIME SETUP (about 5 minutes)
 *  --------------------------------
 *  1. Create a blank Google Sheet (go to sheets.new) and give it a name.
 *  2. In the sheet: Extensions ▸ Apps Script.
 *  3. Delete everything in the editor and paste in this whole file.
 *  4. In the left-hand panel of the editor, click "Services" (+) ▸ choose
 *     "Drive API" ▸ Add.  (Needed to open the AviList .xlsx file.)
 *  5. Click Save (disk icon), then go back to the sheet and reload the page.
 *  6. A new menu "🐦 Bird List" appears. Choose
 *     "Build / rebuild the list".  Google will ask you to authorise the
 *     script: choose your account ▸ Advanced ▸ Go to (project name) ▸ Allow.
 *     (It says "unverified" only because it's your own private script.)
 *  7. Wait 1–4 minutes. The tabs are built and daily updates are switched on.
 *
 *  ADDING YOUR eBIRD DATA (each time you want to update)
 *  -----------------------------------------------------
 *  eBird ▸ My eBird ▸ Download My Data ▸ eBird emails you a link to a .zip.
 *  Then EITHER
 *    A) Save the .zip (or the MyEBirdData.csv inside it) into the Drive folder
 *       "Bird Life List – eBird drop folder". It's processed automatically
 *       within a day, or straight away via 🐦 Bird List ▸ Check drop folder now.
 *  OR
 *    B) Open the "eBird Data" tab ▸ File ▸ Import ▸ Upload the .csv ▸
 *       "Replace current sheet" ▸ then 🐦 Bird List ▸ Process eBird data now.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const CFG = {
  AVILIST_PAGE: 'https://www.avilist.org/checklist/',
  CHECK_EVERY_DAYS: 182,           // ~6 months
  FOLDER_NAME: 'Bird Life List – eBird drop folder',
  PROCESSED_NAME: 'Processed',
  DAILY_HOUR: 6,                   // daily check runs around 6am
};

const STATUS = { WILD: 'Wild', INTRO: 'Introduced', CAPTIVE: 'Captive' };
const STATUS_LIST = [STATUS.WILD, STATUS.INTRO, STATUS.CAPTIVE];

const TAB = {
  START: 'Start Here', SUMMARY: 'Summary', FAMILIES: 'Families', GENERA: 'Genera',
  SPECIES: 'Species', EBIRD: 'eBird Data', FIXES: 'Name Fixes', LOG: 'Taxonomy Log',
  MAP: 'Map',
};

// Species tab columns (1-based)
const SP = {
  SEQ: 1, ORDER: 2, FAMILY: 3, FAMILY_EN: 4, GENUS: 5, SCI: 6, COMMON: 7,
  BREED: 8, BREED_SUB: 9, NONBREED: 10, IUCN: 11, STATUS: 12, LIFER_DATE: 13,
  LIFER_LOC: 14, FORMS: 15, NOTES: 16, PHOTO: 17, FLAG: 18, CODE: 19, ALT: 20,
};
const SP_HEADERS = [
  'Seq', 'Order', 'Family', 'Family (English)', 'Genus', 'Species (Scientific)',
  'Common Name', 'Breeding Region(s)', 'Breeding Subregion(s)', 'Non-breeding Range',
  'IUCN', 'Status', 'Lifer Date', 'Lifer Location', 'Subspecies / Forms Seen',
  'Notes', 'Photo Link', 'Seen flag', 'eBird code', 'Other names',
];
const SP_LAST_VISIBLE = SP.PHOTO;

const COLOURS = {
  header: '#1b4332', headerText: '#ffffff',
  wild: '#c8e6c9', intro: '#b2dfdb', captive: '#ffe0b2',
  complete: '#81c784', extinct: '#9e9e9e', bar: '#2e7d32',
};

// ---------------------------------------------------------------------------
// Range summariser: turns AviList range text into broad regions
// ---------------------------------------------------------------------------
const REGION_ORDER = ['Europe', 'Asia', 'Africa', 'N America', 'Middle America',
  'S America', 'Australasia', 'Pacific Is.', 'Antarctic', 'Oceans'];

// [subregion, region, comma-separated keywords]
const REGION_TABLE = [
  ['N Europe', 'Europe', 'n europe,northern europe,iceland,norway,sweden,finland,denmark,faroe islands,faroes,svalbard,scandinavia,fennoscandia,baltic,baltic states,estonia,latvia,lithuania'],
  ['W Europe', 'Europe', 'w europe,western europe,nw europe,united kingdom,great britain,britain,british isles,ireland,england,scotland,wales,france,belgium,netherlands,luxembourg,germany,switzerland,austria,liechtenstein,alps,pyrenees'],
  ['S Europe', 'Europe', 's europe,southern europe,sw europe,se europe,spain,portugal,iberia,iberian peninsula,italy,sardinia,sicily,corsica,greece,crete,malta,cyprus,balkans,balkan peninsula,croatia,slovenia,serbia,montenegro,albania,north macedonia,macedonia,bosnia and herzegovina,bosnia,bulgaria,balearic islands,mediterranean'],
  ['E Europe', 'Europe', 'e europe,eastern europe,c europe,central europe,poland,czechia,czech republic,slovakia,hungary,romania,moldova,ukraine,belarus,european russia,carpathians'],
  ['Atlantic islands', 'Europe', 'azores,madeira,canary islands,canaries,macaronesia'],
  ['Middle East & Caucasus', 'Asia', 'middle east,sw asia,w asia,turkey,turkiye,anatolia,israel,palestine,jordan,lebanon,syria,iraq,iran,arabia,arabian peninsula,saudi arabia,yemen,oman,united arab emirates,qatar,bahrain,kuwait,sinai,socotra,caucasus,georgia,armenia,azerbaijan,levant,persian gulf'],
  ['Central Asia', 'Asia', 'central asia,c asia,kazakhstan,uzbekistan,turkmenistan,kyrgyzstan,tajikistan,afghanistan,mongolia,xinjiang,tian shan,tien shan,altai,pamirs'],
  ['Siberia & N Asia', 'Asia', 'n asia,siberia,russia,russian far east,kamchatka,sakhalin,kuril islands,kurils,ussuriland,amurland,amur,yakutia,chukotka,urals,ural mountains,commander islands,lake baikal,baikal'],
  ['E Asia', 'Asia', 'e asia,ne asia,east asia,china,japan,korea,korean peninsula,south korea,north korea,taiwan,hong kong,manchuria,tibet,tibetan plateau,ryukyu islands,ryukyus,hokkaido,honshu,kyushu,shikoku,izu islands,bonin islands,ogasawara,sichuan,yunnan,gansu,qinghai,shaanxi,shanxi,guangxi,guangdong,fujian,hainan,hubei,hunan,guizhou,zhejiang,jiangxi,heilongjiang,jilin,liaoning,hebei,inner mongolia'],
  ['S Asia', 'Asia', 's asia,south asia,indian subcontinent,india,pakistan,nepal,bhutan,bangladesh,sri lanka,maldives,himalayas,himalaya,western ghats,eastern ghats,andaman islands,andamans,nicobar islands,nicobars,assam,arunachal pradesh,sikkim,kerala,karnataka,tamil nadu,goa,gujarat,rajasthan,kashmir,ladakh,deccan'],
  ['SE Asia', 'Asia', 'se asia,southeast asia,myanmar,burma,thailand,laos,cambodia,vietnam,viet nam,malaysia,singapore,brunei,indonesia,philippines,borneo,sumatra,java,bali,malay peninsula,peninsular malaysia,indochina,sundaland,greater sundas,palawan,luzon,mindanao,mindoro,negros,panay,cebu,samar,leyte,sulu archipelago,mentawai,mentawai islands,nias,simeulue,natuna'],
  ['Wallacea', 'Australasia', 'wallacea,sulawesi,moluccas,maluku,n moluccas,s moluccas,halmahera,seram,buru,lesser sundas,lesser sunda islands,flores,sumba,sumbawa,lombok,timor,timor-leste,wetar,tanimbar,kai islands,banggai,sula islands,sangihe,talaud'],
  ['N Africa', 'Africa', 'n africa,nw africa,north africa,morocco,algeria,tunisia,libya,egypt,western sahara,sahara,maghreb,nile valley,atlas mountains'],
  ['W Africa', 'Africa', 'w africa,west africa,senegal,gambia,guinea-bissau,guinea,sierra leone,liberia,cote d\'ivoire,ivory coast,ghana,togo,benin,nigeria,mali,burkina faso,niger,mauritania,cape verde,cabo verde,sahel,upper guinea'],
  ['C Africa', 'Africa', 'c africa,central africa,cameroon,chad,central african republic,gabon,congo,republic of the congo,democratic republic of the congo,dem. rep. congo,dr congo,zaire,equatorial guinea,bioko,sao tome,principe,sao tome and principe,congo basin,lower guinea,gulf of guinea'],
  ['E Africa', 'Africa', 'e africa,ne africa,east africa,sudan,south sudan,ethiopia,eritrea,djibouti,somalia,somaliland,kenya,uganda,tanzania,rwanda,burundi,horn of africa,albertine rift,zanzibar,pemba,lake victoria,rift valley'],
  ['Southern Africa', 'Africa', 's africa,sw africa,se africa,southern africa,south africa,angola,zambia,malawi,mozambique,zimbabwe,botswana,namibia,lesotho,eswatini,swaziland,kalahari,karoo,namib,natal,kwazulu-natal,western cape,eastern cape,cape province,transvaal'],
  ['Madagascar & islands', 'Africa', 'madagascar,comoros,mayotte,mauritius,reunion,seychelles,rodrigues,aldabra,mascarenes'],
  ['Canada, Alaska & Greenland', 'N America', 'n north america,canada,alaska,aleutian islands,aleutians,greenland,yukon,british columbia,alberta,saskatchewan,manitoba,ontario,quebec,labrador,newfoundland,nova scotia,new brunswick,nunavut,northwest territories,hudson bay,baffin island'],
  ['USA', 'N America', 'united states,usa,u.s.,contiguous united states,alabama,arizona,arkansas,california,colorado,connecticut,delaware,florida,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,new hampshire,new jersey,new mexico,new york,north carolina,north dakota,ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,tennessee,texas,utah,vermont,virginia,west virginia,washington,wisconsin,wyoming,great plains,great basin,rocky mountains,rockies,appalachians,great lakes,new england,gulf coast'],
  ['Mexico', 'Middle America', 'mexico,baja california,yucatan,yucatan peninsula,oaxaca,chiapas,sonora,jalisco,guerrero,veracruz,sinaloa,chihuahua,durango,michoacan,tamaulipas,nuevo leon,sierra madre,sierra madre occidental,sierra madre oriental,revillagigedo islands'],
  ['Central America', 'Middle America', 'central america,guatemala,belize,honduras,el salvador,nicaragua,costa rica,panama'],
  ['Caribbean', 'Middle America', 'caribbean,west indies,antilles,greater antilles,lesser antilles,bahamas,cuba,isla de la juventud,hispaniola,haiti,dominican republic,jamaica,puerto rico,cayman islands,virgin islands,barbados,martinique,guadeloupe,dominica,st. lucia,saint lucia,st. vincent,saint vincent,grenada,montserrat,antigua,st. kitts,aruba,curacao,bonaire,bermuda,turks and caicos'],
  ['N South America', 'S America', 'n south america,colombia,venezuela,guyana,suriname,french guiana,guianas,guiana shield,trinidad,tobago,trinidad and tobago,tepuis,santa marta'],
  ['Andes & W South America', 'S America', 'w south america,andes,ecuador,peru,bolivia,altiplano'],
  ['Galapagos', 'S America', 'galapagos,galapagos islands'],
  ['Brazil & Amazonia', 'S America', 'e south america,se south america,brazil,amazonia,amazon basin,amazon,atlantic forest,cerrado,caatinga,pantanal,bahia,minas gerais,sao paulo,rio de janeiro,espirito santo,rio grande do sul,santa catarina,parana,mato grosso,pernambuco,alagoas,amazonas,para'],
  ['S South America', 'S America', 's south america,chile,argentina,uruguay,paraguay,patagonia,tierra del fuego,falkland islands,falklands,chaco,pampas,juan fernandez islands,juan fernandez'],
  ['Australia', 'Australasia', 'australia,tasmania,queensland,new south wales,western australia,northern territory,south australia,cape york,cape york peninsula,christmas island,cocos (keeling) islands,cocos islands'],
  ['New Guinea', 'Australasia', 'new guinea,papua new guinea,papua,west papua,bismarck archipelago,new britain,new ireland,admiralty islands,manus,d\'entrecasteaux islands,louisiade archipelago,aru islands,raja ampat,biak'],
  ['New Zealand', 'Australasia', 'new zealand,chatham islands,auckland islands,campbell island,antipodes islands,bounty islands,snares islands,kermadec islands,stewart island'],
  ['Pacific islands', 'Pacific Is.', 'pacific islands,solomon islands,solomons,bougainville,vanuatu,new caledonia,fiji,samoa,american samoa,tonga,polynesia,french polynesia,micronesia,melanesia,hawaii,hawaiian islands,mariana islands,marianas,guam,palau,cook islands,society islands,tahiti,marquesas,marquesas islands,tuamotu,tuamotu archipelago,austral islands,pitcairn,pitcairn islands,kiribati,marshall islands,tuvalu,niue,wallis and futuna,norfolk island,lord howe island,easter island,santa cruz islands,caroline islands,line islands,phoenix islands,tokelau'],
  ['Antarctic & subantarctic', 'Antarctic', 'antarctica,antarctic,antarctic peninsula,subantarctic,sub-antarctic,south georgia,south shetland islands,south orkney islands,south sandwich islands,kerguelen,kerguelen islands,crozet,crozet islands,prince edward islands,marion island,heard island,macquarie island,tristan da cunha,gough island,bouvet island,southern ocean'],
  ['Atlantic', 'Oceans', 'atlantic ocean,atlantic,north sea,st. helena,saint helena,ascension island'],
  ['Pacific', 'Oceans', 'pacific ocean,pacific'],
  ['Indian Ocean', 'Oceans', 'indian ocean,arabian sea,bay of bengal,red sea,chagos'],
  ['Oceans', 'Oceans', 'oceans,pelagic,at sea'],
];

// [comma-separated keywords, comma-separated regions] — no subregion
const GENERIC_TABLE = [
  ['worldwide,cosmopolitan,nearly worldwide,almost worldwide,nearly cosmopolitan', 'Worldwide'],
  ['holarctic,circumpolar', 'Europe,Asia,N America'],
  ['palearctic,palaearctic,eurasia', 'Europe,Asia'],
  ['europe', 'Europe'],
  ['asia,oriental region,tropical asia', 'Asia'],
  ['africa,afrotropics,afrotropical region,sub-saharan africa', 'Africa'],
  ['north america,nearctic', 'N America'],
  ['middle america', 'Middle America'],
  ['south america', 'S America'],
  ['neotropics,neotropical region,latin america', 'Middle America,S America'],
  ['americas,new world', 'N America,Middle America,S America'],
  ['old world', 'Europe,Asia,Africa'],
  ['australasia,australo-papuan region', 'Australasia'],
  ['oceania', 'Australasia,Pacific Is.'],
  // Words that look like places but aren't regions in their own right
  ['pacific slope,pacific coast,pacific lowlands,atlantic slope,caribbean slope,caribbean coast,caribbean lowlands,gulf of mexico,atlantic coast', ''],
];

let KEYWORDS_ = null;
function getKeywords_() {
  if (KEYWORDS_) return KEYWORDS_;
  const list = [];
  REGION_TABLE.forEach(([sub, region, kws]) => kws.split(',').forEach(k => {
    k = k.trim(); if (k) list.push({ kw: k, regions: [region], sub });
  }));
  GENERIC_TABLE.forEach(([kws, regions]) => kws.split(',').forEach(k => {
    k = k.trim(); if (k) list.push({ kw: k, regions: regions ? regions.split(',') : [], sub: null });
  }));
  list.sort((a, b) => b.kw.length - a.kw.length);
  list.forEach(item => {
    const esc = item.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    item.re = new RegExp('(^|[^a-z])(' + esc + ')(?![a-z])', 'g');
  });
  KEYWORDS_ = list;
  return list;
}

function normalise_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’`]/g, "'");
}

/** Finds regions/subregions mentioned in a piece of text. */
function classifyText_(text) {
  let t = ' ' + normalise_(text) + ' ';
  const regions = new Set(), subs = new Set(), broad = new Set();
  getKeywords_().forEach(item => {
    item.re.lastIndex = 0;
    if (!item.re.test(t)) return;
    item.re.lastIndex = 0;
    t = t.replace(item.re, (m, pre, word) => pre + ' '.repeat(word.length));
    item.regions.forEach(r => { regions.add(r); if (!item.sub) broad.add(r); });
    if (item.sub) subs.add(item.sub);
  });
  return { regions, subs, broad };
}

/** Splits a range statement into breeding / non-breeding / ignored parts. */
function splitRange_(text) {
  const out = { breed: [], nonbreed: [] };
  String(text || '')
    .split(/;|\.\s+(?=[A-Z])/)
    .map(s => s.trim()).filter(Boolean)
    .forEach(seg => {
      // "Breeds X, winters Y" in one segment
      seg.split(/,\s*(?=(?:winters?|nonbreeding|non-breeding|migrates?)\b)/i).forEach(part => {
        const p = part.trim(); if (!p) return;
        if (/\b(vagrant|casual|accidental|introduced|escaped|feral)\b/i.test(p)) return;
        if (/\b(winters?|wintering|nonbreeding|non-breeding|migrates?|migrant to|passage|on migration|visitor|disperses|post-breeding)\b/i.test(p)
            && !/^\s*(breeds?|resident)\b/i.test(p)) {
          out.nonbreed.push(p);
        } else {
          out.breed.push(p);
        }
      });
    });
  return out;
}

function formatRegions_(set) {
  if (set.has('Worldwide')) return 'Worldwide';
  return REGION_ORDER.filter(r => set.has(r)).join(', ');
}

function formatSubs_(regions, subs, broad) {
  if (regions.has('Worldwide')) return 'Worldwide';
  const out = [];
  REGION_ORDER.forEach(region => {
    if (!regions.has(region)) return;
    const mine = REGION_TABLE.filter(r => r[1] === region && subs.has(r[0])).map(r => r[0]);
    if (mine.length >= 3 || (broad && broad.has(region))) out.push(region + ' (widespread)');
    else if (mine.length) out.push(...mine);
    else out.push(region);
  });
  return out.join(', ');
}

/**
 * Summarises one species' range text(s).
 * @param {string[]} texts range statements (species, or each subspecies)
 */
function summariseRange_(texts) {
  const bR = new Set(), bS = new Set(), bB = new Set(), nR = new Set(), nS = new Set();
  let hasNonbreeding = false;
  texts.filter(Boolean).forEach(text => {
    const parts = splitRange_(text);
    parts.breed.forEach(p => { const c = classifyText_(p); c.regions.forEach(x => bR.add(x)); c.subs.forEach(x => bS.add(x)); c.broad.forEach(x => bB.add(x)); });
    parts.nonbreed.forEach(p => { hasNonbreeding = true; const c = classifyText_(p); c.regions.forEach(x => nR.add(x)); c.subs.forEach(x => nS.add(x)); });
  });
  let nonbreed;
  if (!hasNonbreeding) nonbreed = bR.size ? 'Resident' : '';
  else {
    // Show only regions the bird moves INTO outside the breeding season
    const extra = new Set([...nR].filter(r => !bR.has(r)));
    nonbreed = extra.size ? formatRegions_(extra) : 'Within breeding range';
  }
  return { breed: formatRegions_(bR), breedSub: formatSubs_(bR, bS, bB), nonbreed, regionSet: bR };
}

// ---------------------------------------------------------------------------
// AviList parsing
// ---------------------------------------------------------------------------
function findCol_(headers, patterns) {
  for (const p of patterns) {
    const i = headers.findIndex(h => p.test(String(h).trim()));
    if (i >= 0) return i;
  }
  return -1;
}

function titleCase_(s) {
  return s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/** Turns the AviList sheet values into a list of species objects. */
function parseAviList_(values) {
  const hr = values.findIndex(r => r.some(c => /^taxon_rank$/i.test(String(c).trim())));
  if (hr < 0) throw new Error('Could not find the "Taxon_rank" column in the AviList file.');
  const H = values[hr];
  const col = {
    seq: findCol_(H, [/^sequence$/i]),
    rank: findCol_(H, [/^taxon_rank$/i]),
    order: findCol_(H, [/^order$/i]),
    family: findCol_(H, [/^family$/i]),
    familyEn: findCol_(H, [/^family_english_name$/i]),
    sci: findCol_(H, [/^scientific_name$/i]),
    en: findCol_(H, [/^english_name_avilist$/i, /^english_name$/i]),
    enClem: findCol_(H, [/^english_name_clements/i]),
    enBL: findCol_(H, [/^english_name_birdlife/i]),
    range: findCol_(H, [/^range$/i]),
    extinct: findCol_(H, [/^extinct/i]),
    iucn: findCol_(H, [/^iucn/i]),
    code: findCol_(H, [/^species_code/i]),
  };
  ['rank', 'order', 'family', 'sci'].forEach(k => {
    if (col[k] < 0) throw new Error('AviList file is missing the ' + k + ' column.');
  });
  const get = (r, k) => (col[k] >= 0 && r[col[k]] !== null && r[col[k]] !== undefined) ? String(r[col[k]]).trim() : '';
  const species = [];
  let cur = null, n = 0;
  for (let i = hr + 1; i < values.length; i++) {
    const r = values[i];
    const rank = get(r, 'rank').toLowerCase();
    if (rank === 'species') {
      n++;
      const sci = get(r, 'sci').replace(/\s+/g, ' ');
      const iucnRaw = get(r, 'iucn');
      const ext = get(r, 'extinct');
      const extinct = /^extinct$/i.test(ext) || /^EX$/i.test(iucnRaw);
      const alt = [get(r, 'enClem'), get(r, 'enBL')].filter(x => x && x !== get(r, 'en'));
      cur = {
        seq: Number(get(r, 'seq')) || n,
        order: titleCase_(get(r, 'order')),
        family: get(r, 'family'),
        familyEn: get(r, 'familyEn'),
        genus: sci.split(' ')[0],
        sci,
        common: get(r, 'en'),
        alt: [...new Set(alt)].join('; '),
        range: get(r, 'range'),
        sspRanges: [],
        iucn: iucnRaw || (extinct ? 'EX' : (/possibly/i.test(ext) ? 'CR (PE)' : '')),
        extinct,
        code: get(r, 'code'),
      };
      species.push(cur);
    } else if (rank === 'subspecies' && cur) {
      const sci = get(r, 'sci');
      const rg = get(r, 'range');
      if (rg && sci.indexOf(cur.sci + ' ') === 0) {
        cur.sspRanges.push({ name: sci.slice(cur.sci.length + 1), range: rg });
      }
    } else if (rank && rank !== 'subspecies') {
      cur = null;
    }
  }
  species.forEach(s => {
    const texts = s.range ? [s.range] : s.sspRanges.map(x => x.range);
    const sum = summariseRange_(texts);
    s.breed = sum.breed; s.breedSub = sum.breedSub; s.nonbreed = sum.nonbreed; s.regionSet = sum.regionSet;
    let note = s.range ? s.range : s.sspRanges.map(x => x.name + ': ' + x.range).join('\n');
    if (note.length > 1800) note = note.slice(0, 1800) + ' …';
    s.note = note ? 'AviList range:\n' + note : '';
  });
  return species;
}

// ---------------------------------------------------------------------------
// eBird parsing
// ---------------------------------------------------------------------------
/** CSV parser that copes with quoted commas and line breaks. */
function parseCsvText_(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Works out what an eBird name refers to.
 * Returns {skip:true} for spuhs, slashes, hybrids and domestics,
 * otherwise {binomial, form}.
 */
function parseEbirdName_(sci, common) {
  sci = String(sci || '').trim().replace(/\s+/g, ' ');
  common = String(common || '').trim();
  if (!sci) return { skip: true, reason: 'blank' };
  if (/domestic/i.test(sci + ' ' + common)) return { skip: true, reason: 'domestic' };
  if (/\bsp\.?$|\bsp\.\s|\bx\b|\(hybrid\)|hybrid/i.test(sci + ' ' + common)) return { skip: true, reason: 'sp/hybrid' };
  const t = sci.split(' ');
  if (t.length < 2 || /\//.test(t[0]) || /\//.test(t[1]) || /^\[|^\(/.test(t[1])) return { skip: true, reason: 'slash' };
  const binomial = t[0] + ' ' + t[1].toLowerCase();
  const rest = t.slice(2).join(' ').trim();
  const paren = common.match(/\(([^)]+)\)\s*$/);
  let form = '';
  if (rest && paren) form = rest + ' (' + paren[1] + ')';
  else if (rest) form = rest;
  else if (paren) form = paren[1];
  return { binomial, form };
}

function normCommon_(s) {
  return normalise_(String(s || '').replace(/\([^)]*\)\s*$/, '')).replace(/[-'\s]+/g, ' ').trim();
}

function parseEbirdDate_(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // eBird uses month/day/year here
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  return null;
}

function parseEbirdTime_(v) {
  if (v instanceof Date && !isNaN(v)) return v.getHours() * 60 + v.getMinutes();
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return 24 * 60;  // unknown time sorts last within the day
  let h = +m[1] % 12; if (!m[3]) h = +m[1]; else if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}

/**
 * Matches one eBird name to a row of the Species tab.
 * Returns {skip:true} for names that aren't countable species,
 * otherwise {target (row index or undefined), form}.
 */
function resolveEbirdName_(sci, common, index) {
  const fix = index.fixes.get(sci.toLowerCase());
  if (fix === 'IGNORE') return { skip: true };
  if (fix) {
    const p = parseEbirdName_(sci, common);
    return { target: index.bySci.get(fix.toLowerCase()), form: p.skip ? '' : p.form };
  }
  const p = parseEbirdName_(sci, common);
  if (p.skip) return { skip: true };
  let target = index.bySci.get(p.binomial.toLowerCase());
  if (target === undefined) target = index.byCommon.get(normCommon_(common));
  return { target, form: p.form };
}

/**
 * Pure step for the maps: species and families seen per country and per place.
 * @param {Array[]} rows eBird rows including header
 * @param {Object} index as for summariseEbird_
 * @param {string[]} familyOf family (scientific) for each Species-tab row index
 */
function summariseLocations_(rows, index, familyOf) {
  const out = { countries: new Map(), places: new Map() };
  if (!rows || rows.length < 2) return out;
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const c = name => H.indexOf(name);
  const col = {
    sci: c('scientific name'), common: c('common name'), state: c('state/province'),
    locId: c('location id'), loc: c('location'), lat: c('latitude'), lng: c('longitude'),
  };
  if (col.sci < 0) return out;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sci = String(r[col.sci] || '').trim();
    if (!sci) continue;
    const res = resolveEbirdName_(sci, col.common >= 0 ? String(r[col.common] || '').trim() : '', index);
    if (res.skip || res.target === undefined || res.target === null) continue;
    const t = res.target, fam = familyOf[t];
    const cc = String(col.state >= 0 ? r[col.state] : '').trim().toUpperCase().split('-')[0];
    const key = String((col.locId >= 0 && r[col.locId]) || (col.loc >= 0 && r[col.loc]) || '').trim();
    if (/^[A-Z]{2}$/.test(cc)) {
      let k = out.countries.get(cc);
      if (!k) { k = { code: cc, species: new Set(), families: new Set(), places: new Set() }; out.countries.set(cc, k); }
      k.species.add(t); k.families.add(fam); if (key) k.places.add(key);
    }
    const lat = Number(col.lat >= 0 ? r[col.lat] : NaN), lng = Number(col.lng >= 0 ? r[col.lng] : NaN);
    if (key && isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
      let pl = out.places.get(key);
      if (!pl) { pl = { name: String(col.loc >= 0 ? r[col.loc] : key), lat, lng, cc, species: new Set(), families: new Set() }; out.places.set(key, pl); }
      pl.species.add(t); pl.families.add(fam);
    }
  }
  return out;
}

/**
 * Pure matching step: works out each species' first sighting.
 * @param {Array[]} rows eBird rows including header row
 * @param {Object} index {bySci: Map, byCommon: Map, fixes: Map}
 */
function summariseEbird_(rows, index) {
  if (!rows || rows.length < 2) return { bySpecies: new Map(), unmatched: new Map(), counted: 0, skipped: 0 };
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const c = name => H.indexOf(name);
  const col = {
    sci: c('scientific name'), common: c('common name'), date: c('date'), time: c('time'),
    loc: c('location'), state: c('state/province'), sub: c('submission id'), ml: c('ml catalog numbers'),
    count: c('count'),
  };
  if (col.sci < 0 || col.date < 0) throw new Error('This doesn\'t look like an eBird "Download My Data" file (no Scientific Name / Date columns).');
  const bySpecies = new Map(), unmatched = new Map();
  let counted = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sci = String(r[col.sci] || '').trim();
    const common = col.common >= 0 ? String(r[col.common] || '').trim() : '';
    if (!sci) continue;
    const res = resolveEbirdName_(sci, common, index);
    if (res.skip) { skipped++; continue; }
    const target = res.target, parsed = { form: res.form };
    if (target === undefined || target === null) {
      const u = unmatched.get(sci) || { sci, common, n: 0 };
      u.n++; unmatched.set(sci, u); continue;
    }
    counted++;
    const date = parseEbirdDate_(r[col.date]);
    const key = date ? date.getTime() + parseEbirdTime_(col.time >= 0 ? r[col.time] : '') * 60000 : Number.MAX_SAFE_INTEGER;
    let s = bySpecies.get(target);
    if (!s) { s = { key: Infinity, forms: new Set(), ml: '' }; bySpecies.set(target, s); }
    if (parsed.form) s.forms.add(parsed.form);
    const ml = col.ml >= 0 ? String(r[col.ml] || '').trim().split(/\s+/)[0] : '';
    if (ml && !s.ml) s.ml = ml;
    if (key < s.key) {
      s.key = key; s.date = date;
      s.loc = [col.loc >= 0 ? r[col.loc] : '', col.state >= 0 ? r[col.state] : ''].filter(Boolean).join(', ');
      s.sub = col.sub >= 0 ? String(r[col.sub] || '').trim() : '';
    }
  }
  return { bySpecies, unmatched, counted, skipped };
}

// ===========================================================================
//  GOOGLE SHEETS PART  (everything below needs Google Apps Script)
// ===========================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🐦 Bird List')
    .addItem('Build / rebuild the list', 'menuSetup')
    .addSeparator()
    .addItem('Process eBird data now (from eBird Data tab)', 'menuProcessEbird')
    .addItem('Check drop folder now', 'menuCheckFolder')
    .addItem('Check for AviList update now', 'menuCheckAviList')
    .addSeparator()
    .addItem('Open interactive map', 'menuOpenMap')
    .addItem('Open eBird drop folder', 'menuOpenFolder')
    .addItem('Turn automatic daily updates on', 'menuInstallTriggers')
    .addToUi();
}

const props_ = () => PropertiesService.getDocumentProperties();
const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();
function toast_(msg, secs) { try { ss_().toast(msg, '🐦 Bird List', secs || 6); } catch (e) { } }

function getOrCreateSheet_(name, index) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = index !== undefined ? ss.insertSheet(name, index) : ss.insertSheet(name);
  return sh;
}

// ---------- Menu actions ----------
function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  if (ss_().getSheetByName(TAB.SPECIES)) {
    const a = ui.alert('Rebuild the list?', 'This re-downloads AviList and rebuilds the tabs. Your Status, Lifer, Notes and Photo entries are kept.', ui.ButtonSet.OK_CANCEL);
    if (a !== ui.Button.OK) return;
  }
  setupAll_();
}

function menuProcessEbird() {
  const r = processEbirdTab_();
  SpreadsheetApp.getUi().alert(r);
}

function menuCheckFolder() {
  const r = checkDropFolder_();
  SpreadsheetApp.getUi().alert(r || 'No new files in the drop folder.');
}

function menuCheckAviList() {
  const r = checkAviList_(false);
  SpreadsheetApp.getUi().alert(r);
}

function menuOpenFolder() {
  const f = getFolder_();
  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Drop your eBird .zip or .csv file in:<br><br>' +
    '<a href="' + f.getUrl() + '" target="_blank">' + f.getName() + '</a></p>').setWidth(380).setHeight(130);
  SpreadsheetApp.getUi().showModalDialog(html, 'eBird drop folder');
}

function menuInstallTriggers() {
  installTriggers_();
  SpreadsheetApp.getUi().alert('Automatic updates are on. Every day around ' + CFG.DAILY_HOUR + 'am the sheet checks the drop folder and the eBird Data tab, and every ~6 months it checks for a new AviList.');
}

// ---------- Setup ----------
function setupAll_() {
  const ss = ss_();
  getFolder_();
  // Make sure the supporting tabs exist (in a sensible order)
  [TAB.START, TAB.SUMMARY, TAB.MAP, TAB.FAMILIES, TAB.GENERA, TAB.SPECIES, TAB.EBIRD, TAB.FIXES, TAB.LOG]
    .forEach((name, i) => getOrCreateSheet_(name, i));
  ss.getSheets().forEach(sh => {     // tidy away the default "Sheet1"
    if (/^Sheet\d*$/.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  setupEbirdTab_(); setupFixesTab_(); setupLogTab_();
  toast_('Downloading AviList… this can take a couple of minutes.', 30);
  let msg;
  try {
    msg = checkAviList_(true);
  } catch (e) {
    renderStartHere_();
    SpreadsheetApp.getUi().alert('Could not load AviList automatically:\n\n' + e.message +
      '\n\nWorkaround: download the AviList "Extended" .xlsx from avilist.org/checklist, put it in the "' +
      CFG.FOLDER_NAME + '" Drive folder, then choose 🐦 Bird List ▸ Check drop folder now.');
    return;
  }
  installTriggers_();
  ss.setActiveSheet(ss.getSheetByName(TAB.START));
  SpreadsheetApp.getUi().alert('All set!\n\n' + msg + '\n\nDaily automatic updates are switched on. Next: add your eBird data (see the Start Here tab).');
}

function installTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyJob')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(CFG.DAILY_HOUR).create();
  props_().setProperty('TRIGGER_ON', new Date().toISOString());
  renderStartHere_();
}

/** Runs every day from the time trigger. */
function dailyJob() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    try { checkDropFolder_(); } catch (e) { log_('Error', 'Drop folder', e.message); }
    try {
      if (ebirdTabSignature_() !== props_().getProperty('EBIRD_SIG')) processEbirdTab_();
    } catch (e) { log_('Error', 'eBird Data tab', e.message); }
    try {
      const last = Number(props_().getProperty('AVILIST_LAST_CHECK') || 0);
      if (Date.now() - last > CFG.CHECK_EVERY_DAYS * 86400000) checkAviList_(false);
    } catch (e) { log_('Error', 'AviList check', e.message); }
  } finally { lock.releaseLock(); }
}

// ---------- Drive folder ----------
function getFolder_() {
  const p = props_();
  const id = p.getProperty('FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const f = DriveApp.createFolder(CFG.FOLDER_NAME);
  f.setDescription('Drop your eBird "Download My Data" .zip or .csv here. Processed files move to the Processed subfolder.');
  p.setProperty('FOLDER_ID', f.getId());
  return f;
}

function getProcessedFolder_() {
  const f = getFolder_();
  const it = f.getFoldersByName(CFG.PROCESSED_NAME);
  return it.hasNext() ? it.next() : f.createFolder(CFG.PROCESSED_NAME);
}

function checkDropFolder_() {
  const folder = getFolder_();
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  if (!files.length) return '';
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());   // newest first
  const done = getProcessedFolder_();
  const msgs = [];
  // AviList file dropped in by hand?
  const avi = files.find(f => /avilist/i.test(f.getName()) && /\.xlsx$/i.test(f.getName()));
  if (avi) {
    msgs.push(loadAviListFromBlob_(avi.getBlob(), versionFromName_(avi.getName()), 'manual file'));
    avi.moveTo(done);
  }
  // Newest eBird export wins (each export contains ALL of your data)
  let ebirdDone = false;
  files.filter(f => f !== avi).forEach(f => {
    const name = f.getName();
    let csvText = null;
    if (/\.zip$/i.test(name) || f.getMimeType() === 'application/zip') {
      const parts = Utilities.unzip(f.getBlob().setContentType('application/zip'));
      const csv = parts.find(b => /\.csv$/i.test(b.getName()));
      if (csv) csvText = csv.getDataAsString('UTF-8');
    } else if (/\.csv$/i.test(name) || f.getMimeType() === 'text/csv') {
      csvText = f.getBlob().getDataAsString('UTF-8');
    } else return;
    if (csvText && !ebirdDone) {
      const rows = parseCsvText_(csvText);
      writeEbirdTab_(rows);
      msgs.push(applyEbird_(rows, name));
      ebirdDone = true;
    }
    f.moveTo(done);
  });
  return msgs.join('\n\n');
}

// ---------- AviList ----------
function versionFromName_(name) {
  const m = String(name).match(/avilist[-_ ]?(v?\d{4}[a-z]?)/i);
  return m ? m[1].replace(/^(\d)/, 'v$1') : 'unknown version';
}

/** Checks avilist.org for a newer file. force=true reloads even if unchanged. */
function checkAviList_(force) {
  const p = props_();
  const res = UrlFetchApp.fetch(CFG.AVILIST_PAGE, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('avilist.org returned HTTP ' + res.getResponseCode());
  const html = res.getContentText();
  const links = html.match(/https?:\/\/[^"'\s<>]+?\.xlsx/gi) || [];
  const url = links.find(u => /extended/i.test(u)) || links.find(u => /avilist/i.test(u));
  if (!url) throw new Error('Could not find the AviList download link on ' + CFG.AVILIST_PAGE);
  p.setProperty('AVILIST_LAST_CHECK', String(Date.now()));
  const version = versionFromName_(url.split('/').pop());
  if (!force && url === p.getProperty('AVILIST_URL') && ss_().getSheetByName(TAB.SPECIES)) {
    renderStartHere_();
    return 'AviList is up to date (' + version + ').';
  }
  const blob = UrlFetchApp.fetch(url).getBlob().setName(url.split('/').pop());
  const msg = loadAviListFromBlob_(blob, version, url);
  p.setProperty('AVILIST_URL', url);
  return msg;
}

function loadAviListFromBlob_(blob, version, source) {
  const values = readXlsx_(blob);
  const species = parseAviList_(values);
  if (species.length < 5000) throw new Error('Only ' + species.length + ' species found — the AviList file looks wrong, nothing was changed.');
  const p = props_();
  const oldVersion = p.getProperty('AVILIST_VERSION');
  buildFromAviList_(species, oldVersion && oldVersion !== version ? oldVersion : null, version);
  p.setProperty('AVILIST_VERSION', version);
  p.setProperty('AVILIST_SOURCE', source || '');
  p.setProperty('AVILIST_LOADED', String(Date.now()));
  p.setProperty('AVILIST_LAST_CHECK', String(Date.now()));
  log_('AviList loaded', version, species.length + ' species');
  // Re-apply eBird data to the new list
  const eb = ss_().getSheetByName(TAB.EBIRD);
  let extra = '';
  if (eb && eb.getLastRow() > 1) extra = '\n' + processEbirdTab_();
  renderStartHere_();
  return 'Loaded AviList ' + version + ' (' + species.length.toLocaleString() + ' species).' + extra;
}

/** Converts an .xlsx blob to a temporary Google Sheet and reads the main tab. */
function readXlsx_(blob) {
  if (typeof Drive === 'undefined') {
    throw new Error('The Drive API service is not switched on. In the Apps Script editor: Services (+) ▸ Drive API ▸ Add, then try again.');
  }
  blob.setContentType(MimeType.MICROSOFT_EXCEL);
  let id;
  if (Drive.Files.create) {         // Drive API v3
    id = Drive.Files.create({ name: 'AviList temp (safe to delete)', mimeType: MimeType.GOOGLE_SHEETS }, blob).id;
  } else {                          // Drive API v2
    id = Drive.Files.insert({ title: 'AviList temp (safe to delete)', mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true }).id;
  }
  try {
    const tmp = SpreadsheetApp.openById(id);
    const sheets = tmp.getSheets();
    const main = sheets.find(s => /^avilist/i.test(s.getName())) || sheets[0];
    return main.getDataRange().getValues();
  } finally {
    DriveApp.getFileById(id).setTrashed(true);
  }
}

// ---------- Build the tabs ----------
function readUserData_() {
  const sh = ss_().getSheetByName(TAB.SPECIES);
  const bySci = new Map(), byCode = new Map();
  if (!sh || sh.getLastRow() < 2) return { bySci, byCode, all: [] };
  const n = sh.getLastRow() - 1;
  const ids = sh.getRange(2, SP.SCI, n, 1).getValues();
  const codes = sh.getRange(2, SP.CODE, n, 1).getValues();
  const commons = sh.getRange(2, SP.COMMON, n, 1).getDisplayValues();
  const vals = sh.getRange(2, SP.STATUS, n, SP.PHOTO - SP.STATUS + 1).getValues();
  const fmls = sh.getRange(2, SP.STATUS, n, SP.PHOTO - SP.STATUS + 1).getFormulas();
  const notes = sh.getRange(2, SP.STATUS, n, 1).getNotes();
  const all = [];
  for (let i = 0; i < n; i++) {
    const cells = vals[i].map((v, j) => fmls[i][j] || v);
    if (cells.every(v => v === '' || v === null)) continue;
    const rec = { sci: String(ids[i][0]), code: String(codes[i][0]), common: commons[i][0], cells, statusNote: notes[i][0], used: false };
    bySci.set(rec.sci, rec);
    if (rec.code) byCode.set(rec.code, rec);
    all.push(rec);
  }
  return { bySci, byCode, all };
}

function styleHeader_(range) {
  range.setBackground(COLOURS.header).setFontColor(COLOURS.headerText).setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
}

function resetSheet_(sh, rows, cols) {
  const f = sh.getFilter(); if (f) f.remove();
  sh.clearConditionalFormatRules();
  sh.getBandings().forEach(b => b.remove());
  sh.clear(); sh.clearNotes();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxRows() > rows + 1) sh.deleteRows(rows + 2, sh.getMaxRows() - rows - 1);
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
  sh.showColumns(1, cols);
}

function q_(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

function buildFromAviList_(species, oldVersion, version) {
  const ss = ss_();
  const user = readUserData_();

  // ----- Species tab -----
  const sh = getOrCreateSheet_(TAB.SPECIES);
  const n = species.length;
  resetSheet_(sh, n + 1, SP_HEADERS.length);
  const rows = [], breedNotes = [], statusNotes = [];
  species.forEach(s => {
    const prev = user.bySci.get(s.sci) || (s.code && user.byCode.get(s.code)) || null;
    if (prev) prev.used = true;
    const userCells = prev ? prev.cells : ['', '', '', '', '', ''];
    const common = s.code
      ? '=HYPERLINK(' + q_('https://ebird.org/species/' + s.code) + ',' + q_(s.common) + ')'
      : s.common;
    rows.push([s.seq, s.order, s.family, s.familyEn, s.genus, s.sci, common,
      s.breed, s.breedSub, s.nonbreed, s.iucn, ...userCells, '', s.code, s.alt]);
    breedNotes.push([s.note]);
    statusNotes.push([prev ? prev.statusNote : '']);
  });
  sh.getRange(1, 1, 1, SP_HEADERS.length).setValues([SP_HEADERS]);
  sh.getRange(2, 1, n, SP_HEADERS.length).setValues(rows);
  sh.getRange(2, SP.BREED, n, 1).setNotes(breedNotes);
  sh.getRange(2, SP.STATUS, n, 1).setNotes(statusNotes);
  // Seen flag: 1 = seen in the wild (Wild or Introduced)
  sh.getRange(1, SP.FLAG).setFormula('={"Seen flag";ARRAYFORMULA(IF(F2:F="",,IF((L2:L="' + STATUS.WILD + '")+(L2:L="' + STATUS.INTRO + '"),1,0)))}');
  sh.getRange(2, SP.FLAG, n, 1).clearContent();
  // Formatting
  styleHeader_(sh.getRange(1, 1, 1, SP_HEADERS.length));
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  // Order → Genus can be collapsed with the [–] above the columns to declutter
  try {
    if (sh.getColumnGroupDepth(SP.ORDER) === 0) sh.getRange(1, SP.ORDER, 1, SP.GENUS - SP.ORDER + 1).shiftColumnGroupDepth(1);
  } catch (e) { }
  sh.getRange(2, 1, n, SP_HEADERS.length).setFontSize(10).setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange(2, SP.SCI, n, 1).setFontStyle('italic');
  sh.getRange(2, SP.LIFER_DATE, n, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(2, SP.IUCN, n, 1).setHorizontalAlignment('center');
  const widths = { 2: 120, 3: 120, 4: 170, 5: 110, 6: 190, 7: 200, 8: 170, 9: 220, 10: 150, 11: 50, 12: 85, 13: 95, 14: 220, 15: 180, 16: 220, 17: 110 };
  Object.keys(widths).forEach(c => sh.setColumnWidth(+c, widths[c]));
  sh.hideColumns(SP.SEQ); sh.hideColumns(SP.FLAG, 3);
  // Status dropdown
  sh.getRange(2, SP.STATUS, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_LIST, true).setAllowInvalid(false)
    .setHelpText('Wild = seen in its natural wild range. Introduced = seen wild but outside its native range. Captive = zoo, collection or escape. Leave blank if not seen.').build());
  // Colour coding
  const body = sh.getRange(2, 1, n, SP_LAST_VISIBLE);
  sh.setConditionalFormatRules([
    cf_('=$L2="' + STATUS.WILD + '"', body, COLOURS.wild),
    cf_('=$L2="' + STATUS.INTRO + '"', body, COLOURS.intro),
    cf_('=$L2="' + STATUS.CAPTIVE + '"', body, COLOURS.captive),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$K2="EX"')
      .setFontColor(COLOURS.extinct).setItalic(true).setRanges([body]).build(),
  ]);
  sh.getRange(1, 1, n + 1, SP_LAST_VISIBLE).createFilter();

  // ----- Families & Genera -----
  buildFamiliesTab_(species);
  buildGeneraTab_(species);
  buildSummaryTab_(species);

  // ----- Orphaned user data (taxonomy changes) -----
  const orphans = user.all.filter(r => !r.used);
  orphans.forEach(r => log_('Check after AviList update', r.sci + (r.common ? ' (' + r.common + ')' : ''),
    'Your entry no longer matches a species in ' + version + (oldVersion ? ' (was in ' + oldVersion + ')' : '') +
    '. Saved values: ' + r.cells.filter(Boolean).map(String).join(' | ')));
  if (orphans.length) toast_(orphans.length + ' of your entries need checking — see the Taxonomy Log tab.', 15);
}

function cf_(formula, range, bg, bold) {
  const b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(bg).setRanges([range]);
  if (bold) b.setBold(true);
  return b.build();
}

function sparkline_(cell) {
  return '=SPARKLINE(' + cell + ',{"charttype","bar";"max",1;"color1","' + COLOURS.bar + '"})';
}

function buildFamiliesTab_(species) {
  const sh = getOrCreateSheet_(TAB.FAMILIES);
  const fams = [], map = new Map();
  species.forEach(s => {
    let f = map.get(s.family);
    if (!f) { f = { order: s.order, family: s.family, en: s.familyEn, n: 0, genera: new Set(), regions: new Set() }; map.set(s.family, f); fams.push(f); }
    if (!s.extinct) { f.n++; f.genera.add(s.genus); s.regionSet.forEach(r => f.regions.add(r)); }
  });
  const headers = ['Order', 'Family', 'Family (English)', 'Found in', 'Species', 'Genera', 'Species seen', 'Genera seen', '% seen', 'Progress', 'Captive only'];
  resetSheet_(sh, fams.length + 1, headers.length);
  const rows = fams.map((f, i) => {
    const r = i + 2;
    let found = f.regions.has('Worldwide') ? 'Worldwide' : REGION_ORDER.filter(x => f.regions.has(x)).join(', ');
    if (f.n === 0) found = 'Extinct family';
    else if (f.regions.size >= 7) found = 'Nearly worldwide';
    return [f.order, f.family, f.en, found, f.n, f.genera.size,
      '=COUNTIFS(Species!$C:$C,$B' + r + ',Species!$R:$R,1)',
      '=IFERROR(COUNTUNIQUEIFS(Species!$E:$E,Species!$C:$C,$B' + r + ',Species!$R:$R,1),0)',
      '=IF($E' + r + '=0,0,$G' + r + '/$E' + r + ')',
      sparkline_('$I' + r),
      '=COUNTIFS(Species!$C:$C,$B' + r + ',Species!$L:$L,"' + STATUS.CAPTIVE + '")'];
  });
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  finishProgressTab_(sh, rows.length, headers.length, 9, 7, 11, 5,
    { 1: 130, 2: 140, 3: 260, 4: 230, 5: 65, 6: 65, 7: 80, 8: 80, 9: 60, 10: 120, 11: 70 }, 2);
}

function buildGeneraTab_(species) {
  const sh = getOrCreateSheet_(TAB.GENERA);
  const gens = [], map = new Map();
  species.forEach(s => {
    let g = map.get(s.genus);
    if (!g) { g = { order: s.order, family: s.family, en: s.familyEn, genus: s.genus, n: 0 }; map.set(s.genus, g); gens.push(g); }
    if (!s.extinct) g.n++;
  });
  const headers = ['Order', 'Family', 'Family (English)', 'Genus', 'Species', 'Species seen', '% seen', 'Progress', 'Captive only'];
  resetSheet_(sh, gens.length + 1, headers.length);
  const rows = gens.map((g, i) => {
    const r = i + 2;
    return [g.order, g.family, g.en, g.genus, g.n,
      '=COUNTIFS(Species!$E:$E,$D' + r + ',Species!$R:$R,1)',
      '=IF($E' + r + '=0,0,$F' + r + '/$E' + r + ')',
      sparkline_('$G' + r),
      '=COUNTIFS(Species!$E:$E,$D' + r + ',Species!$L:$L,"' + STATUS.CAPTIVE + '")'];
  });
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.getRange(2, 4, rows.length, 1).setFontStyle('italic');
  finishProgressTab_(sh, rows.length, headers.length, 7, 6, 9, 5,
    { 1: 130, 2: 140, 3: 240, 4: 140, 5: 65, 6: 80, 7: 60, 8: 120, 9: 70 }, 0);
}

/** Shared formatting for Families / Genera. Column numbers are 1-based. */
function finishProgressTab_(sh, n, cols, pctCol, seenCol, captiveCol, totalCol, widths, frozenCols) {
  styleHeader_(sh.getRange(1, 1, 1, cols));
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1); sh.setFrozenColumns(frozenCols);
  sh.getRange(2, 1, n, cols).setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(2, pctCol, n, 1).setNumberFormat('0%');
  sh.getRange(2, totalCol, n, cols - totalCol + 1).setHorizontalAlignment('center');
  Object.keys(widths).forEach(c => sh.setColumnWidth(+c, widths[c]));
  const L = c => String.fromCharCode(64 + c);
  const body = sh.getRange(2, 1, n, cols);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L(totalCol) + '2=0')
      .setFontColor(COLOURS.extinct).setItalic(true).setRanges([body]).build(),
    cf_('=$' + L(pctCol) + '2>=1', body, COLOURS.complete, true),
    cf_('=$' + L(seenCol) + '2>0', body, COLOURS.wild),
    cf_('=$' + L(captiveCol) + '2>0', body, COLOURS.captive),
  ]);
  sh.getRange(1, 1, n + 1, cols).createFilter();
}

function buildSummaryTab_(species) {
  const sh = getOrCreateSheet_(TAB.SUMMARY);
  const orders = [], omap = new Map();
  species.forEach(s => {
    let o = omap.get(s.order);
    if (!o) { o = { order: s.order, fams: new Set(), n: 0 }; omap.set(s.order, o); orders.push(o); }
    if (!s.extinct) { o.n++; o.fams.add(s.family); }
  });
  const extant = species.filter(s => !s.extinct).length;
  const top = 10 + orders.length + 2;
  resetSheet_(sh, Math.max(top, 30), 13);
  sh.getRange('A1').setValue('My World Bird List').setFontSize(20).setFontWeight('bold').setFontColor(COLOURS.header);
  sh.getRange('A2').setFormula('="Checklist: AviList "&IFERROR(\'Start Here\'!B22,"")').setFontColor('#666666');
  const head = [['', 'Seen', 'Total', '% seen', 'Progress']];
  const stats = [
    ['Orders', '=COUNTUNIQUEIFS(Families!A2:A,Families!G2:G,">0")', '=COUNTUNIQUEIFS(Families!A2:A,Families!E2:E,">0")'],
    ['Families', '=COUNTIF(Families!G2:G,">0")', '=COUNTIF(Families!E2:E,">0")'],
    ['Genera', '=COUNTIF(Genera!F2:F,">0")', '=COUNTIF(Genera!E2:E,">0")'],
    ['Species', '=COUNTIF(Species!R2:R,1)', extant],
  ].map((r, i) => [...r, '=IF(C' + (i + 5) + '=0,0,B' + (i + 5) + '/C' + (i + 5) + ')', sparkline_('D' + (i + 5))]);
  sh.getRange('A4:E4').setValues(head); styleHeader_(sh.getRange('A4:E4'));
  sh.getRange('A5:E8').setValues(stats);
  sh.getRange('A9:B9').setValues([['Captive-only species', '=COUNTIF(Species!L2:L,"' + STATUS.CAPTIVE + '")']]);
  sh.getRange('A5:A9').setFontWeight('bold');
  sh.getRange('B5:C9').setHorizontalAlignment('center');
  sh.getRange('D5:D8').setNumberFormat('0.0%').setHorizontalAlignment('center');
  sh.getRange('B5:B8').setFontSize(14).setFontWeight('bold').setFontColor(COLOURS.bar);
  // Progress by order
  sh.getRange('A11:G11').setValues([['Order', 'Families', 'Families seen', 'Species', 'Species seen', '% seen', 'Progress']]);
  styleHeader_(sh.getRange('A11:G11'));
  const orows = orders.map((o, i) => {
    const r = 12 + i;
    return [o.order, o.fams.size, '=COUNTIFS(Families!$A:$A,$A' + r + ',Families!$G:$G,">0")', o.n,
      '=COUNTIFS(Species!$B:$B,$A' + r + ',Species!$R:$R,1)', '=IF(D' + r + '=0,0,E' + r + '/D' + r + ')', sparkline_('F' + r)];
  });
  sh.getRange(12, 1, orows.length, 7).setValues(orows);
  sh.getRange(12, 6, orows.length, 1).setNumberFormat('0%');
  sh.getRange(12, 2, orows.length, 5).setHorizontalAlignment('center');
  const obody = sh.getRange(12, 1, orows.length, 7);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D12=0').setFontColor(COLOURS.extinct).setItalic(true).setRanges([obody]).build(),
    cf_('=$F12>=1', obody, COLOURS.complete, true),
    cf_('=$E12>0', obody, COLOURS.wild),
  ]);
  // Latest lifers
  sh.getRange('I4:L4').setValues([['Lifer date', 'Species', 'Family', 'Where']]);
  styleHeader_(sh.getRange('I4:L4'));
  sh.getRange('I5').setFormula('=IFERROR(SORTN(FILTER({Species!M2:M,Species!G2:G,Species!D2:D,Species!N2:N},Species!M2:M<>""),20,0,1,FALSE),"No lifers yet — add your eBird data")');
  sh.getRange('I5:I24').setNumberFormat('d mmm yyyy');
  sh.getRange('I3').setValue('Latest 20 lifers').setFontWeight('bold');
  [[1, 170], [2, 75], [3, 75], [4, 75], [5, 120], [6, 60], [7, 120], [8, 30], [9, 95], [10, 200], [11, 190], [12, 240]]
    .forEach(([c, w]) => sh.setColumnWidth(c, w));
  sh.setFrozenRows(0); sh.setHiddenGridlines(true);
}

// ---------- Small tabs ----------
const EBIRD_HEADERS = ['Submission ID', 'Common Name', 'Scientific Name', 'Taxonomic Order', 'Count', 'State/Province', 'County', 'Location ID', 'Location', 'Latitude', 'Longitude', 'Date', 'Time', 'Protocol', 'Duration (Min)', 'All Obs Reported', 'Distance Traveled (km)', 'Area Covered (ha)', 'Number of Observers', 'Breeding Code', 'Observation Details', 'Checklist Comments', 'ML Catalog Numbers'];

function setupEbirdTab_() {
  const sh = getOrCreateSheet_(TAB.EBIRD);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, EBIRD_HEADERS.length).setValues([EBIRD_HEADERS]);
    styleHeader_(sh.getRange(1, 1, 1, EBIRD_HEADERS.length));
    sh.setFrozenRows(1);
  }
  sh.getRange('A1').setNote('Import your eBird MyEBirdData.csv here: File ▸ Import ▸ Upload ▸ "Replace current sheet". Then 🐦 Bird List ▸ Process eBird data now (or wait for the daily run).');
  sh.setTabColor('#4a90d9');
}

function setupFixesTab_() {
  const sh = getOrCreateSheet_(TAB.FIXES);
  if (sh.getLastRow() === 0) {
    const h = ['eBird Scientific Name', 'eBird Common Name', 'AviList species to count it as (scientific name, or IGNORE)', 'Records', 'Added'];
    sh.getRange(1, 1, 1, h.length).setValues([h]);
    styleHeader_(sh.getRange(1, 1, 1, h.length)); sh.setRowHeight(1, 40);
    sh.setFrozenRows(1);
    [[1, 240], [2, 220], [3, 300], [4, 70], [5, 95]].forEach(([c, w]) => sh.setColumnWidth(c, w));
    sh.getRange('C1').setNote('When an eBird name can\'t be matched automatically it appears here. Type the AviList scientific name (as in the Species tab) in column C, or IGNORE to skip it. It is used next time eBird data is processed.');
  }
  sh.setTabColor('#f4b400');
}

function setupLogTab_() {
  const sh = getOrCreateSheet_(TAB.LOG);
  if (sh.getLastRow() === 0) {
    const h = ['When', 'What', 'Name', 'Details'];
    sh.getRange(1, 1, 1, h.length).setValues([h]);
    styleHeader_(sh.getRange(1, 1, 1, h.length));
    sh.setFrozenRows(1);
    [[1, 140], [2, 190], [3, 260], [4, 600]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  }
  sh.setTabColor('#999999');
}

function log_(what, name, detail) {
  try {
    const sh = ss_().getSheetByName(TAB.LOG) || (setupLogTab_(), ss_().getSheetByName(TAB.LOG));
    sh.appendRow([new Date(), what, name, detail]);
  } catch (e) { console.log(what, name, detail); }
}

// ---------- eBird processing ----------
function writeEbirdTab_(rows) {
  const sh = getOrCreateSheet_(TAB.EBIRD);
  const width = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => { const x = r.slice(); while (x.length < width) x.push(''); return x; });
  sh.clearContents();
  if (sh.getMaxRows() < norm.length) sh.insertRowsAfter(sh.getMaxRows(), norm.length - sh.getMaxRows());
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  // Write as plain text so nothing gets reinterpreted
  sh.getRange(1, 1, norm.length, width).setNumberFormat('@');
  for (let i = 0; i < norm.length; i += 10000) {
    const chunk = norm.slice(i, i + 10000);
    sh.getRange(i + 1, 1, chunk.length, width).setValues(chunk);
  }
  styleHeader_(sh.getRange(1, 1, 1, width));
}

function ebirdTabSignature_() {
  const sh = ss_().getSheetByName(TAB.EBIRD);
  if (!sh || sh.getLastRow() < 2) return 'empty';
  const last = sh.getLastRow();
  return last + '|' + sh.getRange(2, 1, 1, 3).getDisplayValues()[0].join('/') + '|' + sh.getRange(last, 1, 1, 3).getDisplayValues()[0].join('/');
}

function processEbirdTab_() {
  const sh = ss_().getSheetByName(TAB.EBIRD);
  if (!sh || sh.getLastRow() < 2) return 'The eBird Data tab is empty — import your MyEBirdData.csv there first.';
  const rows = sh.getDataRange().getValues();
  return applyEbird_(rows, 'eBird Data tab');
}

function readFixes_() {
  const map = new Map();
  const sh = ss_().getSheetByName(TAB.FIXES);
  if (!sh || sh.getLastRow() < 2) return { map, listed: new Set() };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const listed = new Set();
  v.forEach(r => {
    const k = String(r[0]).trim(); if (!k) return;
    listed.add(k);
    const t = String(r[2]).trim();
    if (t) map.set(k.toLowerCase(), /^ignore$/i.test(t) ? 'IGNORE' : t);
  });
  return { map, listed };
}

function applyEbird_(rows, sourceName) {
  const ss = ss_();
  const sh = ss.getSheetByName(TAB.SPECIES);
  if (!sh || sh.getLastRow() < 2) return 'Build the species list first (🐦 Bird List ▸ Build / rebuild the list).';
  const n = sh.getLastRow() - 1;
  const sci = sh.getRange(2, SP.SCI, n, 1).getValues();
  const common = sh.getRange(2, SP.COMMON, n, 1).getDisplayValues();
  const alt = sh.getRange(2, SP.ALT, n, 1).getValues();
  const bySci = new Map(), byCommon = new Map();
  for (let i = 0; i < n; i++) {
    bySci.set(String(sci[i][0]).toLowerCase(), i);
    const names = [common[i][0]].concat(String(alt[i][0] || '').split(';'));
    names.forEach(nm => { const k = normCommon_(nm); if (k && !byCommon.has(k)) byCommon.set(k, i); });
  }
  const fixes = readFixes_();
  const res = summariseEbird_(rows, { bySci, byCommon, fixes: fixes.map });

  // Read user columns (Status ... Photo), keeping formulas
  const width = SP.PHOTO - SP.STATUS + 1;
  const rng = sh.getRange(2, SP.STATUS, n, width);
  const vals = rng.getValues(), fmls = rng.getFormulas();
  const cells = vals.map((r, i) => r.map((v, j) => fmls[i][j] || v));
  const noteRng = sh.getRange(2, SP.STATUS, n, 1);
  const notes = noteRng.getNotes();
  const S = 0, D = 1, L = 2, F = 3, P = 5;   // offsets within the block
  let newLifers = 0, updated = 0;
  res.bySpecies.forEach((s, i) => {
    const c = cells[i];
    const status = c[S];
    const link = s.sub ? '=HYPERLINK(' + q_('https://ebird.org/checklist/' + s.sub) + ',' + q_(s.loc || s.sub) + ')' : (s.loc || '');
    const existing = c[D] instanceof Date ? c[D] : parseEbirdDate_(c[D]);
    if (!status || status === STATUS.CAPTIVE) {
      if (status === STATUS.CAPTIVE && (existing || c[L])) {
        notes[i][0] = (notes[i][0] ? notes[i][0] + '\n' : '') + 'Previously Captive: ' +
          (existing ? Utilities.formatDate(existing, Session.getScriptTimeZone(), 'd MMM yyyy') : '') + ' ' + String(c[L]).replace(/^=HYPERLINK\([^,]+,"(.*)"\)$/, '$1');
      }
      c[S] = STATUS.WILD; c[D] = s.date || ''; c[L] = link; newLifers++;
    } else if (s.date && (!existing || s.date.getTime() < existing.getTime())) {
      c[D] = s.date; c[L] = link; updated++;          // an earlier sighting turned up
    } else if (!c[L] && link) {
      c[L] = link;
    }
    if (s.forms.size) {
      const have = new Set(String(c[F] || '').split(/;\s*/).filter(Boolean));
      s.forms.forEach(f => have.add(f));
      c[F] = [...have].sort().join('; ');
    }
    if (!c[P] && s.ml) c[P] = '=HYPERLINK(' + q_('https://macaulaylibrary.org/asset/' + s.ml) + ',"ML photo")';
  });
  rng.setValues(cells);
  noteRng.setNotes(notes);

  // Unmatched names → Name Fixes tab
  const fsh = ss.getSheetByName(TAB.FIXES) || (setupFixesTab_(), ss.getSheetByName(TAB.FIXES));
  const toAdd = [];
  res.unmatched.forEach(u => { if (!fixes.listed.has(u.sci)) toAdd.push([u.sci, u.common, '', u.n, new Date()]); });
  if (toAdd.length) fsh.getRange(fsh.getLastRow() + 1, 1, toAdd.length, 5).setValues(toAdd);
  const unresolved = [...res.unmatched.keys()].length;

  const p = props_();
  p.setProperties({
    EBIRD_LAST_IMPORT: String(Date.now()), EBIRD_SOURCE: sourceName || '',
    EBIRD_ROWS: String(rows.length - 1), EBIRD_MATCHED: String(res.bySpecies.size),
    EBIRD_UNMATCHED: String(unresolved), EBIRD_SIG: ebirdTabSignature_(),
  });
  try { updateMapTab_(rows); } catch (e) { log_('Error', 'Map tab', e.message); }
  renderStartHere_();
  const msg = 'eBird data processed: ' + (rows.length - 1).toLocaleString() + ' records, ' +
    res.bySpecies.size + ' species matched, ' + newLifers + ' newly marked as seen' +
    (updated ? ', ' + updated + ' lifer dates moved earlier' : '') + '.' +
    (unresolved ? '\n' + unresolved + ' eBird name(s) could not be matched — see the Name Fixes tab.' : '');
  toast_(msg, 10);
  return msg;
}

// ---------- Start Here tab ----------
function renderStartHere_() {
  const sh = getOrCreateSheet_(TAB.START, 0);
  const p = props_().getProperties();
  const fmt = ms => ms ? Utilities.formatDate(new Date(Number(ms)), Session.getScriptTimeZone(), 'd MMM yyyy HH:mm') : '—';
  let folderUrl = '';
  try { folderUrl = getFolder_().getUrl(); } catch (e) { }
  const nextCheck = p.AVILIST_LAST_CHECK ? Number(p.AVILIST_LAST_CHECK) + CFG.CHECK_EVERY_DAYS * 86400000 : null;
  sh.clear();
  const lines = [
    ['My World Bird List — start here', ''],
    ['', ''],
    ['HOW TO ADD NEW eBIRD SIGHTINGS', ''],
    ['1. In eBird: My eBird ▸ Download My Data. eBird emails you a link to a .zip file.', ''],
    ['2a. Easiest: save that .zip (or the MyEBirdData.csv inside it) into the Drive folder linked below. It is picked up automatically once a day, or straight away via 🐦 Bird List ▸ Check drop folder now.', ''],
    ['2b. Or: open the "eBird Data" tab ▸ File ▸ Import ▸ Upload ▸ "Replace current sheet", then 🐦 Bird List ▸ Process eBird data now.', ''],
    ['3. New species are marked Wild with their first (lifer) date and location. Anything eBird names that can\'t be matched appears in the Name Fixes tab.', ''],
    ['', ''],
    ['THINGS YOU FILL IN YOURSELF (on the Species tab)', ''],
    ['• Status: Wild / Introduced / Captive (dropdown). eBird only records wild birds, so set Captive or Introduced by hand.', ''],
    ['• Notes and Photo Link (paste a Google Drive share link). A Macaulay Library link is added automatically if you uploaded media to eBird and the cell is empty.', ''],
    ['• Hover over a Breeding Region cell to see the full AviList range description.', ''],
    ['• The Map tab shades the countries where you\'ve seen birds. For a zoomable map with pins for every place you\'ve birded: 🐦 Bird List ▸ Open interactive map.', ''],
    ['', ''],
    ['COLOURS', ''],
    ['Seen in the wild', ''], ['Seen wild, introduced population', ''], ['Captive / zoo only', ''], ['Every species in the family or genus seen', ''], ['Extinct', ''],
    ['', ''],
    ['AviList version', p.AVILIST_VERSION || '—'],
    ['AviList loaded', fmt(p.AVILIST_LOADED)],
    ['Last AviList check', fmt(p.AVILIST_LAST_CHECK)],
    ['Next AviList check (about)', nextCheck ? fmt(nextCheck) : '—'],
    ['Last eBird import', fmt(p.EBIRD_LAST_IMPORT) + (p.EBIRD_SOURCE ? '  (' + p.EBIRD_SOURCE + ')' : '')],
    ['eBird records / species matched', (p.EBIRD_ROWS || '0') + ' records / ' + (p.EBIRD_MATCHED || '0') + ' species'],
    ['eBird names needing a fix', p.EBIRD_UNMATCHED || '0'],
    ['Automatic daily updates', p.TRIGGER_ON ? 'On (around ' + CFG.DAILY_HOUR + 'am)' : 'Off — 🐦 Bird List ▸ Turn automatic daily updates on'],
    ['eBird drop folder', folderUrl ? '=HYPERLINK(' + q_(folderUrl) + ',' + q_(CFG.FOLDER_NAME) + ')' : '—'],
  ];
  sh.getRange(1, 1, lines.length, 2).setValues(lines);
  sh.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor(COLOURS.header);
  ['A3', 'A9', 'A15'].forEach(a => sh.getRange(a).setFontWeight('bold').setFontColor(COLOURS.header));
  sh.getRange('A16').setBackground(COLOURS.wild); sh.getRange('A17').setBackground(COLOURS.intro);
  sh.getRange('A18').setBackground(COLOURS.captive); sh.getRange('A19').setBackground(COLOURS.complete).setFontWeight('bold');
  sh.getRange('A20').setFontColor(COLOURS.extinct).setFontStyle('italic');
  sh.getRange('A22:A30').setFontWeight('bold');
  sh.getRange('A22:B30').setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
  sh.setColumnWidth(1, 620); sh.setColumnWidth(2, 330);
  sh.getRange('A1:A20').setWrap(true);
  sh.setHiddenGridlines(true);
  sh.setTabColor(COLOURS.header);
}

// ===========================================================================
//  MAPS — the Map tab (Google geo chart) and the pop-up interactive map
// ===========================================================================
const COUNTRY_NAMES = ('AD:Andorra|AE:United Arab Emirates|AF:Afghanistan|AG:Antigua and Barbuda|AI:Anguilla|AL:Albania|AM:Armenia|AO:Angola|AQ:Antarctica|AR:Argentina|AS:American Samoa|AT:Austria|AU:Australia|AW:Aruba|AX:Åland Islands|AZ:Azerbaijan|' +
  'BA:Bosnia and Herzegovina|BB:Barbados|BD:Bangladesh|BE:Belgium|BF:Burkina Faso|BG:Bulgaria|BH:Bahrain|BI:Burundi|BJ:Benin|BL:Saint Barthélemy|BM:Bermuda|BN:Brunei|BO:Bolivia|BQ:Caribbean Netherlands|BR:Brazil|BS:Bahamas|BT:Bhutan|BV:Bouvet Island|BW:Botswana|BY:Belarus|BZ:Belize|' +
  'CA:Canada|CC:Cocos (Keeling) Islands|CD:DR Congo|CF:Central African Republic|CG:Congo|CH:Switzerland|CI:Côte d\'Ivoire|CK:Cook Islands|CL:Chile|CM:Cameroon|CN:China|CO:Colombia|CR:Costa Rica|CU:Cuba|CV:Cabo Verde|CW:Curaçao|CX:Christmas Island|CY:Cyprus|CZ:Czechia|' +
  'DE:Germany|DJ:Djibouti|DK:Denmark|DM:Dominica|DO:Dominican Republic|DZ:Algeria|EC:Ecuador|EE:Estonia|EG:Egypt|EH:Western Sahara|ER:Eritrea|ES:Spain|ET:Ethiopia|FI:Finland|FJ:Fiji|FK:Falkland Islands|FM:Micronesia|FO:Faroe Islands|FR:France|' +
  'GA:Gabon|GB:United Kingdom|GD:Grenada|GE:Georgia|GF:French Guiana|GG:Guernsey|GH:Ghana|GI:Gibraltar|GL:Greenland|GM:Gambia|GN:Guinea|GP:Guadeloupe|GQ:Equatorial Guinea|GR:Greece|GS:South Georgia & S. Sandwich Is.|GT:Guatemala|GU:Guam|GW:Guinea-Bissau|GY:Guyana|' +
  'HK:Hong Kong|HM:Heard & McDonald Islands|HN:Honduras|HR:Croatia|HT:Haiti|HU:Hungary|ID:Indonesia|IE:Ireland|IL:Israel|IM:Isle of Man|IN:India|IO:British Indian Ocean Territory|IQ:Iraq|IR:Iran|IS:Iceland|IT:Italy|JE:Jersey|JM:Jamaica|JO:Jordan|JP:Japan|' +
  'KE:Kenya|KG:Kyrgyzstan|KH:Cambodia|KI:Kiribati|KM:Comoros|KN:Saint Kitts and Nevis|KP:North Korea|KR:South Korea|KW:Kuwait|KY:Cayman Islands|KZ:Kazakhstan|LA:Laos|LB:Lebanon|LC:Saint Lucia|LI:Liechtenstein|LK:Sri Lanka|LR:Liberia|LS:Lesotho|LT:Lithuania|LU:Luxembourg|LV:Latvia|LY:Libya|' +
  'MA:Morocco|MC:Monaco|MD:Moldova|ME:Montenegro|MF:Saint Martin|MG:Madagascar|MH:Marshall Islands|MK:North Macedonia|ML:Mali|MM:Myanmar|MN:Mongolia|MO:Macao|MP:Northern Mariana Islands|MQ:Martinique|MR:Mauritania|MS:Montserrat|MT:Malta|MU:Mauritius|MV:Maldives|MW:Malawi|MX:Mexico|MY:Malaysia|MZ:Mozambique|' +
  'NA:Namibia|NC:New Caledonia|NE:Niger|NF:Norfolk Island|NG:Nigeria|NI:Nicaragua|NL:Netherlands|NO:Norway|NP:Nepal|NR:Nauru|NU:Niue|NZ:New Zealand|OM:Oman|PA:Panama|PE:Peru|PF:French Polynesia|PG:Papua New Guinea|PH:Philippines|PK:Pakistan|PL:Poland|PM:Saint Pierre and Miquelon|PN:Pitcairn Islands|PR:Puerto Rico|PS:Palestine|PT:Portugal|PW:Palau|PY:Paraguay|' +
  'QA:Qatar|RE:Réunion|RO:Romania|RS:Serbia|RU:Russia|RW:Rwanda|SA:Saudi Arabia|SB:Solomon Islands|SC:Seychelles|SD:Sudan|SE:Sweden|SG:Singapore|SH:Saint Helena|SI:Slovenia|SJ:Svalbard and Jan Mayen|SK:Slovakia|SL:Sierra Leone|SM:San Marino|SN:Senegal|SO:Somalia|SR:Suriname|SS:South Sudan|ST:São Tomé and Príncipe|SV:El Salvador|SX:Sint Maarten|SY:Syria|SZ:Eswatini|' +
  'TC:Turks and Caicos Islands|TD:Chad|TF:French Southern Territories|TG:Togo|TH:Thailand|TJ:Tajikistan|TK:Tokelau|TL:Timor-Leste|TM:Turkmenistan|TN:Tunisia|TO:Tonga|TR:Türkiye|TT:Trinidad and Tobago|TV:Tuvalu|TW:Taiwan|TZ:Tanzania|' +
  'UA:Ukraine|UG:Uganda|UM:US Minor Outlying Islands|US:United States|UY:Uruguay|UZ:Uzbekistan|VA:Vatican City|VC:Saint Vincent and the Grenadines|VE:Venezuela|VG:British Virgin Islands|VI:US Virgin Islands|VN:Vietnam|VU:Vanuatu|WF:Wallis and Futuna|WS:Samoa|XK:Kosovo|YE:Yemen|YT:Mayotte|ZA:South Africa|ZM:Zambia|ZW:Zimbabwe')
  .split('|').reduce((o, p) => { const i = p.indexOf(':'); o[p.slice(0, i)] = p.slice(i + 1); return o; }, {});

/** Reads the Species tab and eBird Data tab and works out the map data. */
function buildMapData_(rows) {
  const ss = ss_();
  const sh = ss.getSheetByName(TAB.SPECIES);
  if (!sh || sh.getLastRow() < 2) return null;
  if (!rows) {
    const eb = ss.getSheetByName(TAB.EBIRD);
    rows = eb && eb.getLastRow() > 1 ? eb.getDataRange().getValues() : [];
  }
  const n = sh.getLastRow() - 1;
  const fam = sh.getRange(2, SP.FAMILY, n, 2).getValues();          // Family, Family (English)
  const sci = sh.getRange(2, SP.SCI, n, 1).getValues();
  const common = sh.getRange(2, SP.COMMON, n, 1).getDisplayValues();
  const alt = sh.getRange(2, SP.ALT, n, 1).getValues();
  const bySci = new Map(), byCommon = new Map();
  for (let i = 0; i < n; i++) {
    bySci.set(String(sci[i][0]).toLowerCase(), i);
    [common[i][0]].concat(String(alt[i][0] || '').split(';')).forEach(nm => {
      const k = normCommon_(nm); if (k && !byCommon.has(k)) byCommon.set(k, i);
    });
  }
  const loc = summariseLocations_(rows, { bySci, byCommon, fixes: readFixes_().map }, fam.map(r => r[0]));
  return { loc, fam, sci, common };
}

function updateMapTab_(rows) {
  const data = buildMapData_(rows);
  if (!data) return;
  const sh = getOrCreateSheet_(TAB.MAP, Math.min(2, ss_().getSheets().length));
  sh.getCharts().forEach(c => sh.removeChart(c));
  const f = sh.getFilter(); if (f) f.remove();
  sh.clear(); sh.clearConditionalFormatRules();
  sh.setHiddenGridlines(true); sh.setTabColor(COLOURS.bar);
  sh.getRange('A1').setValue('Where I\'ve seen birds').setFontSize(18).setFontWeight('bold').setFontColor(COLOURS.header);
  sh.getRange('A2').setValue('Every eBird sighting counts in the country where it was made. For a zoomable map with your birding places: 🐦 Bird List ▸ Open interactive map.')
    .setFontColor('#666666');
  const list = [...data.loc.countries.values()]
    .map(k => [k.code, k.species.size, k.families.size, COUNTRY_NAMES[k.code] || k.code, k.places.size])
    .sort((a, b) => b[1] - a[1] || String(a[3]).localeCompare(String(b[3])));
  const head = ['Code', 'Species seen', 'Families seen', 'Country', 'Places birded'];
  sh.getRange(4, 1, 1, head.length).setValues([head]);
  styleHeader_(sh.getRange(4, 1, 1, head.length));
  [[1, 55], [2, 95], [3, 95], [4, 200], [5, 95], [6, 20]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  if (!list.length) {
    sh.getRange('A5').setValue('No eBird sightings with a country yet — add your eBird data first.');
    return;
  }
  sh.getRange(5, 1, list.length, head.length).setValues(list);
  sh.getRange(5, 1, list.length, head.length).setFontSize(10);
  sh.getRange(5, 1, list.length, 3).setHorizontalAlignment('center');
  sh.getRange(5, 5, list.length, 1).setHorizontalAlignment('center');
  sh.getRange(5 + list.length + 1, 1, 1, 4).setValues([['', '', '', 'Countries: ' + list.length]]).setFontWeight('bold');
  const builder = sh.newChart()
    .setChartType(Charts.ChartType.GEO)
    .addRange(sh.getRange(4, 1, list.length + 1, 2))
    .setPosition(1, 7, 0, 0)
    .setOption('title', 'Species seen by country (hover a country for its total)')
    .setOption('width', 820).setOption('height', 470)
    .setOption('colorAxis', { colors: ['#c8e6c9', '#66bb6a', '#1b4332'] })
    .setOption('datalessRegionColor', '#f1f1f1');
  try { builder.setNumHeaders(1); } catch (e) { }
  sh.insertChart(builder.build());
}

function menuOpenMap() {
  const data = buildMapData_();
  if (!data) { SpreadsheetApp.getUi().alert('Build the species list first (🐦 Bird List ▸ Build / rebuild the list).'); return; }
  // Compact payload: species used on the map, plus countries and places referring to them
  const spIdx = new Map(), sp = [];
  const ref = t => {
    if (!spIdx.has(t)) { spIdx.set(t, sp.length); sp.push([data.common[t][0], data.fam[t][1] || data.fam[t][0]]); }
    return spIdx.get(t);
  };
  const countries = {};
  data.loc.countries.forEach(k => {
    countries[k.code] = { n: COUNTRY_NAMES[k.code] || k.code, s: [...k.species].map(ref), f: k.families.size, p: k.places.size };
  });
  const places = [...data.loc.places.values()].map(p => ({
    n: p.name, lat: Math.round(p.lat * 1e4) / 1e4, lng: Math.round(p.lng * 1e4) / 1e4,
    c: COUNTRY_NAMES[p.cc] || p.cc, s: [...p.species].map(ref), f: p.families.size,
  }));
  const payload = JSON.stringify({ sp, countries, places }).replace(/</g, '\\u003c');
  const html = HtmlService.createHtmlOutput(MAP_HTML_.replace('__DATA__', () => payload))
    .setWidth(1150).setHeight(720);
  SpreadsheetApp.getUi().showModelessDialog(html, 'My bird map');
}

const MAP_HTML_ = `<!DOCTYPE html><html><head><base target="_blank">
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html,body{margin:0;height:100%;font-family:Arial,Helvetica,sans-serif;color:#1d2a22}
  #map{position:absolute;top:0;bottom:0;left:0;right:270px;background:#dfe9ee}
  #side{position:absolute;top:0;bottom:0;right:0;width:270px;box-sizing:border-box;border-left:1px solid #d5ddd8;background:#fbfcfb;display:flex;flex-direction:column}
  #side .head{padding:14px 14px 10px;border-bottom:1px solid #e3e8e5}
  h1{font-size:16px;margin:0 0 8px;color:#1b4332}
  .stats{display:flex;gap:12px;margin-bottom:10px}
  .stat b{display:block;font-size:20px;color:#2e7d32}
  .stat span{font-size:11px;color:#667}
  .seg{display:flex;border:1px solid #1b4332;border-radius:6px;overflow:hidden;margin:6px 0 8px}
  .seg button{flex:1;border:0;background:#fff;padding:6px 0;font-size:12px;cursor:pointer;color:#1b4332}
  .seg button.on{background:#1b4332;color:#fff}
  label{font-size:12px;cursor:pointer;user-select:none}
  #list{overflow:auto;flex:1;padding:4px 0}
  .row{display:flex;justify-content:space-between;gap:8px;padding:6px 14px;font-size:12.5px;cursor:pointer}
  .row:hover{background:#e8f3ec}
  .row .v{color:#2e7d32;font-weight:bold;white-space:nowrap}
  .legend{background:#fff;padding:8px 10px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.25);font-size:11.5px;line-height:18px}
  .legend i{display:inline-block;width:16px;height:11px;margin-right:6px;vertical-align:middle;border:1px solid #9bb}
  .pop h3{margin:0 0 2px;font-size:14px}
  .pop .sub{color:#667;font-size:12px;margin-bottom:6px}
  .pop ul{max-height:230px;overflow:auto;margin:0;padding:0 0 0 16px;font-size:12px}
  .pop li span{color:#889}
  #note{font-size:11px;color:#a05a00;margin-top:6px}
</style></head><body>
<div id="map"></div>
<div id="side">
  <div class="head">
    <h1>Where I've seen birds</h1>
    <div class="stats"><div class="stat"><b id="tC">0</b><span>countries</span></div>
      <div class="stat"><b id="tP">0</b><span>places</span></div><div class="stat"><b id="tS">0</b><span>species</span></div></div>
    <div style="font-size:12px">Shade countries by</div>
    <div class="seg"><button id="bS" class="on">Species</button><button id="bF">Families</button></div>
    <label><input type="checkbox" id="pins" checked> Show my birding places</label>
    <div id="note"></div>
  </div>
  <div id="list"></div>
</div>
<script>
const D = __DATA__;
const GREENS = ['#d8f0dc','#a5d6a7','#66bb6a','#2e7d32','#1b4332'];
let mode = 's', geo = null, breaks = [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val = c => c ? (mode === 's' ? c.s.length : c.f) : 0;
const codes = Object.keys(D.countries);
document.getElementById('tC').textContent = codes.length;
document.getElementById('tP').textContent = D.places.length;
document.getElementById('tS').textContent = D.sp.length;

const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([25, 10], 2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 18 }).addTo(map);

function listHtml(ids) {
  const items = ids.map(i => D.sp[i]).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  return '<ul>' + items.map(x => '<li>' + esc(x[0]) + ' <span>· ' + esc(x[1]) + '</span></li>').join('') + '</ul>';
}
function countryPopup(code) {
  const c = D.countries[code];
  return '<div class="pop"><h3>' + esc(c.n) + '</h3><div class="sub">' + c.s.length + ' species · ' + c.f + ' families · ' + c.p + ' places</div>' + listHtml(c.s) + '</div>';
}
function computeBreaks() {
  const max = Math.max(1, ...codes.map(k => val(D.countries[k])));
  const b = [1];
  for (let k = 2; k <= 5; k++) { const x = Math.max(1, Math.round(max * Math.pow((k - 1) / 4, 2))); if (x > b[b.length - 1]) b.push(x); }
  breaks = b;
}
function colourFor(v) {
  if (!v) return null;
  let i = 0; while (i + 1 < breaks.length && v >= breaks[i + 1]) i++;
  return GREENS[Math.min(GREENS.length - 1, Math.round(i * (GREENS.length - 1) / Math.max(1, breaks.length - 1)))];
}
function styleFeature(f) {
  const c = D.countries[f.properties._code]; const col = colourFor(val(c));
  return { weight: 0.6, color: '#8aa39a', fillColor: col || '#ffffff', fillOpacity: col ? 0.85 : 0 };
}
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => L.DomUtil.create('div', 'legend');
legend.addTo(map);
function drawLegend() {
  const el = document.querySelector('.legend');
  let h = '<b>' + (mode === 's' ? 'Species' : 'Families') + ' seen</b><br>';
  breaks.forEach((b, i) => { const hi = breaks[i + 1] ? breaks[i + 1] - 1 : null;
    h += '<i style="background:' + colourFor(b) + '"></i>' + b + (hi === null ? '+' : (hi > b ? '–' + hi : '')) + '<br>'; });
  h += '<i style="background:#2e7d32;border-radius:50%;width:11px"></i>Place I\\'ve birded';
  el.innerHTML = h;
}
function drawList() {
  const sorted = codes.slice().sort((a, b) => val(D.countries[b]) - val(D.countries[a]) || D.countries[a].n.localeCompare(D.countries[b].n));
  document.getElementById('list').innerHTML = sorted.map(k => '<div class="row" data-c="' + k + '"><span>' + esc(D.countries[k].n) +
    '</span><span class="v">' + val(D.countries[k]) + '</span></div>').join('') || '<div class="row">No sightings yet</div>';
  document.querySelectorAll('#list .row[data-c]').forEach(r => r.onclick = () => focusCountry(r.dataset.c));
}
function refresh() { computeBreaks(); if (geo) geo.setStyle(styleFeature); drawLegend(); drawList(); }
function focusCountry(code) {
  let layer = null;
  if (geo) geo.eachLayer(l => { if (l.feature.properties._code === code) layer = l; });
  if (layer) { map.fitBounds(layer.getBounds(), { maxZoom: 6 }); layer.openPopup(); return; }
  const pts = D.places.filter(p => p.c === D.countries[code].n);
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.3), { maxZoom: 8 });
  L.popup().setLatLng(pts.length ? [pts[0].lat, pts[0].lng] : map.getCenter()).setContent(countryPopup(code)).openOn(map);
}
// Places
const pinLayer = L.layerGroup(D.places.sort((a, b) => b.s.length - a.s.length).map(p =>
  L.circleMarker([p.lat, p.lng], { radius: Math.min(18, 4 + 1.6 * Math.sqrt(p.s.length)), color: '#ffffff', weight: 1.2,
    fillColor: '#2e7d32', fillOpacity: 0.85 })
   .bindTooltip(esc(p.n) + ' — ' + p.s.length + ' species')
   .bindPopup('<div class="pop"><h3>' + esc(p.n) + '</h3><div class="sub">' + esc(p.c) + ' · ' + p.s.length + ' species · ' + p.f + ' families</div>' + listHtml(p.s) + '</div>', { maxWidth: 320 })
)).addTo(map);
document.getElementById('pins').onchange = e => e.target.checked ? pinLayer.addTo(map) : map.removeLayer(pinLayer);
const bS = document.getElementById('bS'), bF = document.getElementById('bF');
bS.onclick = () => { mode = 's'; bS.classList.add('on'); bF.classList.remove('on'); refresh(); };
bF.onclick = () => { mode = 'f'; bF.classList.add('on'); bS.classList.remove('on'); refresh(); };
refresh();
// Country outlines (Natural Earth, public domain)
fetch('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson')
  .then(r => r.json()).then(g => {
    g.features.forEach(f => { const p = f.properties; let c = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
      if (c === '-99' || !c) c = ''; p._code = c; });
    geo = L.geoJSON(g, { style: styleFeature, onEachFeature: (f, l) => {
      const c = D.countries[f.properties._code];
      if (c) { l.bindTooltip(esc(c.n) + ': ' + c.s.length + ' species, ' + c.f + ' families', { sticky: true });
               l.bindPopup(countryPopup(f.properties._code), { maxWidth: 320 }); }
    }}).addTo(map);
    geo.bringToBack(); pinLayer.eachLayer(m => m.bringToFront());
  }).catch(() => { document.getElementById('note').textContent = 'Country outlines could not load (no internet?) — places and the list still work.'; });
if (!codes.length) document.getElementById('note').textContent = 'No eBird sightings yet — add your eBird data, then reopen the map.';
</script></body></html>`;
