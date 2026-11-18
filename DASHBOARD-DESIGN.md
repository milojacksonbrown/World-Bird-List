# Design: Bird List web dashboard

Status: agreed 10 Nov 2026. First working version needed by 18 Nov 2026.

## Problem

My life list works well in Google Sheets, but only for me. To use it, a friend would have to copy the spreadsheet, install the script and approve Google's permission screens. It also looks like a spreadsheet, and the most interesting things (lifers per year, how much of each region I've seen) are spread across tabs or not shown at all.

## Goal

A web page that anyone can open, where they upload their own eBird data and see their life list as a dashboard. It's for me and my friends, and it's a case study of using AI carefully. It has two AI features:

1. **Name Fixes assistant:** suggests the AviList species for eBird names that can't be matched (as in `DESIGN.md`).
2. **Ask a question:** plain-English questions about your list ("Which families have I seen less than 10% of?"), answered from your own data.

## How someone uses it

1. Open the web page. No account and nothing to install.
2. In eBird: My eBird ▸ Download My Data, then unzip the email attachment.
3. Upload `MyEBirdData.csv`, or click **Try with sample data** (my own list).
4. The dashboard appears. Unmatched names are listed with suggestions to accept.
5. Next visit: upload the file again. Accepted name fixes are remembered in that browser.

## What's on it

| Section | Contents |
|---|---|
| Headline numbers | Species seen, % of the world's living species, families, orders, countries |
| Through the years | Four charts in two rows. Top: lifers per year, and lifers per month of the year (all years together) to show seasonality. Bottom: every species recorded per year (the year list) and per month, lifer or not, each with a dashed line for the number of checklists, because species counts also depend on how much birding was done |
| Latest lifers | The latest 10 lifers (date, species, place, eBird checklist link), with *Show all* to expand the full list and a search box that finds any lifer by common name, scientific name or family (ignoring capitals and accents) |
| Where in the world | A map of the countries birded in, each shaded by the number of species recorded there (square-root scale, so countries with a handful of species still stand out); unbirded countries stay plain. Beside it, bars for each AviList region: species seen out of species breeding there. "Oceans" (seabirds) gets its own card. *Done 14 Nov:* countries (and, zoomed in, states and counties) are now shaded by the % of the species eBird has recorded there that I've seen, in five fixed bands (under 5%, 5–10%, 10–20%, 20–40%, 40%+), so a shade means the same everywhere. The totals come from the eBird API (`tools/fetch-region-totals.js`); a place with no total gets its own "no eBird total" shade, and without the totals file the old species scale is used |
| Explore | *Added 18 Nov:* pick a country, state or county (or click Explore on the map) for the species eBird has had reported there in the last 30 days that aren't on your list, by family, with last date and place. Through Lyrebird's `recent` action (eBird key in its settings, an hour's cache, its own daily cap); place names hidden where eBird marks them private |
| Test yourself | *Added 17 Nov:* a quiz on the visitor's own lifers, from their stickers. Multiple choice (easy: any lifers as wrong answers; hard: same family, then order, then body shape) or typed (any AviList name, the scientific name, small slips forgiven). Ten a round, missed birds listed with links to their fact files, best score in local storage. Pure functions `quizPool_`, `quizOptions_`, `quizCheck_` with tests |
| Stickers and fact files | *Added 17 Nov:* each species' icon is its sticker from huashu-bird-sticker (CC BY 4.0, AI-generated, pinned to commit 3b42ef8), as a 96-pixel copy kept with the site; the family silhouette is the fallback. Clicking a bird in Latest lifers or an answer opens its fact file: the full sticker (from the pinned CDN, labelled as an AI illustration, with credit), AviList's range text, IUCN status, size and life facts each labelled with its source, the visitor's own records, and links to eBird and Bird Album. Built by `tools/build-factfiles.js`. The fact file also has a range map: GBIF records for June–July and December–January (vector tiles, decoded and drawn as SVG in the page's colours), with the visitor's own sightings; and IUCN categories are colour-coded |
| Bird traits (in Ask a question) | *Added 17 Nov:* species also carry traits from AVONET and BIRDBASE (weight, wing, tail, beak, range size, lifestyle, migration, main habitat and diet, altitude, island breeding, restricted range, flightlessness, clutch, nest), built by `tools/build-traits.js`. One source per field; weight falls back from AVONET to BIRDBASE because both are average mass in grams, and each value records its source. Coverage: `Tests/trait-coverage.md` |
| Ask a question | Question box, the query it was understood as, and the results table |
| Name fixes | Unmatched eBird names, each with suggestion, confidence, reason and Accept |
| Footer | AviList version and credit, licence, how the data is handled |

**After 18 Nov:** a second map mode ("where I've birded": countries by species seen, plus pins, as in the spreadsheet's map), family and genus detail, uploading the eBird .zip directly, saving the whole list between visits.

## Look

Field-guide style, like a modern bird book rather than an app:

- Warm paper-coloured background, dark ink text, natural greens and earth tones as accents.
- Serif headings (book-like), with a clean sans-serif for numbers and tables so they stay easy to read.
- Sections laid out like plates in a guide: a heading, a short caption, then the chart or list.
- Scientific names in italics, as in field guides.
- Works on a phone as well as a laptop.
- Light mode only, whatever the device setting: darker always means more.
- Section headings only (no "Plate I, II…" labels).
- *Added 13 Nov (later):* where eBird's State/Province codes are groups (the UK's nations, France's regions, Ireland's provinces, Indonesia's island groups), the country view goes down to counties, matching eBird's County column to the county outlines by name within each nation or region (London = its 33 boroughs, drawn as one). Counties with no single outline (e.g. "West Midlands", which the source splits into boroughs) are still listed. Bars beside the map show % of the species ever recorded in each place, from eBird's totals (`tools/fetch-region-totals.js`, run with my own eBird API key, which is never stored; only the counts are saved, in `docs/data/region-totals.json`, credited to eBird in the footer). Without a total there is no bar, so nothing looks complete that isn't.
- *Added 13 Nov:* clicking a birded country (or its button under the map) zooms into its states, provinces or regions, shaded by species on the country's own scale, and the bars beside the map list them with species and lifers. Outlines: Natural Earth 1:10m admin-1, split into one small file per country (`docs/data/regions/`, made by `tools/build-regions.js`) and loaded only when a country is opened. eBird's State/Province codes are ISO 3166-2, but at different levels: the UK uses its four nations, France its regions, Ireland its four provinces and Indonesia its island groups, so those outlines are grouped to match (drawn as their parts in one colour). Checked against all 2,200 of my sightings: every region code points at the right place; the only misses are on coasts and tiny islands that simplified outlines leave out, which don't affect the shading (it comes from the codes, not the coordinates).
- *Added 13 Nov:* each lifer has a silhouette of its body shape, like a field guide. `docs/js/bird-icons.js` maps every AviList family to one of 32 shapes (mostly by order, with exceptions such as herons vs ibises, gulls vs sandpipers, crows and finches vs other songbirds), and draws each shape from a few numbers (body, head, bill, tail, legs) so all icons share one style. Decorative (hidden from screen readers), with the shape's name as a tooltip. A test checks every family has a drawn shape.
- A dashed red "expedition route" flows behind the page (no loops), showing in the gaps between sections and the margins. It starts at a multi-directional signpost by the title and ends at a red X ("X marks the spot") below the footer. Solid line-drawn icons sit along it: a mountain, forest and lake around the title, where the effect is seen most, and a forest and lake at bends further down. Drawn by code from the section positions and redrawn whenever the page changes size; decoration only (hidden from screen readers).

## Where the data comes from

- **AviList v2026**, converted once on my computer into a compact data file that ships with the site: scientific and common names, order, family, IUCN category, eBird species code and breeding regions. Regions are worked out in advance with the existing range summariser, so the long range text doesn't need to be shipped.
- **The visitor's eBird file**, read in their browser using the existing functions from `LifeList.gs` (`parseCsvText_`, `summariseEbird_`, `resolveEbirdName_`). It's the same matching code as the spreadsheet, not a second copy.

## AI design

### Lyrebird, the AI middleman

The Gemini key can't go in a public web page: anyone could copy it from the page source. A small, **separate** Apps Script project (not my spreadsheet's script) acts as a middleman. It's called **Lyrebird**, after the bird famous for passing on sounds it has heard: it passes the website's questions to Gemini and the answers back.

- It holds the key in its Script Properties, like the spreadsheet does.
- It accepts two kinds of request: `nameFix` and `query`. Anything else is rejected.
- It calls Gemini and returns the reply.
- **Daily cap** (for example 200 requests a day in total). After that it says "AI limit reached for today", and the site keeps working without AI.
- It never stores requests and has no access to any spreadsheet.
- *Added 12 Nov (later):* models are tried in the order set by Script Property `AI_MODELS`; names starting `groq:` go to Groq (key `GROQ_API_KEY`, strict JSON Schema). Recommended: `groq:openai/gpt-oss-120b, gemini-3-flash-preview`. GPT-OSS 120B scored 16/16 at ~2.5 s.
- *Added 12 Nov:* if the main model (Gemini 3 Flash) is out of free quota, busy or withdrawn, it asks a backup model (Gemma 4) instead, with the same checks. The reply says which model answered, and the site shows a note when it was the backup. (Testing: Flash 14/16, Gemma 10/16 on the same questions; Flash's free daily quota ran out within hours.)

### 1. Name Fixes assistant

The same method as `DESIGN.md`, split between the browser and Lyrebird:

| Step | Where |
|---|---|
| String matching and shortlist | Browser (existing code) |
| Ask Gemini to pick from the shortlist | Lyrebird |
| Check the answer is on the shortlist | Lyrebird **and** browser |
| Confidence (High / Medium / Low) | Browser (existing `decideSuggestion_`) |
| Accept | Browser; the fix is remembered in that browser |
| Other candidates | Browser: the whole shortlist with *Use this*, plus a search box for any AviList species, so the right species can always be reached even if the AI is wrong or unavailable (also covers renamed species that aren't on the shortlist) |

Sent to the AI: the unmatched eBird name and the shortlist names only.

### 2. Ask a question

The AI doesn't answer the question. It translates it into a small, structured query, and the browser runs that query on the visitor's own data.

1. The browser sends the question to Lyrebird, which adds a description of what can be searched: the tables (species, families, orders, countries, places, years, months), their fields, and the allowed comparisons, sorts and limits.
2. Gemini replies with a query in a fixed JSON shape (its `responseSchema`), or "cannot" with a reason.
3. The query is checked, in Lyrebird and again in the browser: every table, field and comparison must be on the allowed list, and values must be the right type. Anything else is rejected with a message.

*Added later:* a **places** table (every state, province and county birded, with species, lifers, firsts, and the % of eBird's recorded species seen) and a `places` list on each species, so "which county…" and "what have I seen in Suffolk" can be answered. State names and totals come from `docs/data/region-totals.json`; without it, states show as codes and % seen is empty.

*As built (session 4):* the allowed tables live in one place, `ASK_TABLES_` in `AskYourList.gs`, and the prompt, the checker and the plain-English description are all generated from it, so they can't disagree. Families and orders are worked out from the species rows when the query runs, so a region limit ("in Africa") changes their totals correctly. The query shape:

```json
{ "table": "families", "region": "Africa",
  "filters": [{ "field": "pctSeen", "op": "lt", "value": "10" }],
  "sortField": "pctSeen", "sortDir": "asc", "limit": 25 }
```
4. The browser runs the query and shows the results, plus a plain-English line saying how it was understood (for example "Families in Africa, % seen under 10%, lowest first"), so the person can spot a misreading.

**Sent to the AI:** the question text only. No sightings, names from the list, dates or places. The data never leaves the browser.

**Example questions it should handle:**
- Which families have I seen less than 10% of?
- How many lifers did I get in 2024?
- Which threatened species have I seen?
- What were my first 10 lifers in Asia?

**What it can't answer (yet):** anything below country level (counties, parks, trips), counts of individual birds, and questions needing two steps ("species I've seen in only one country"). These get "can't answer that" rather than a guess.

## How it will be built

| Part | What it is |
|---|---|
| `docs/` | The website (GitHub Pages serves this folder): `index.html`, `app.js`, `styles.css` |
| `docs/data/avilist-v2026.json` | The converted checklist |
| `tools/build-avilist.js` | Converts the AviList download into that file (run on my computer with Node) |
| `tools/build-site.js` | Copies `LifeList.gs`, `NameFixesAssistant.gs` and `AskYourList.gs` into the site as `.js` files, so both use the same code |
| `Lyrebird/Lyrebird.gs` | Lyrebird, in its own Apps Script project together with copies of `NameFixesAssistant.gs` (the name-fix prompt, Gemini call and answer checks) and `AskYourList.gs`, deployed as a web app (*Execute as: Me*, *Anyone*). `docs/js/config.js` holds its web address |
| `AskYourList.gs` | The question tool: the allowed tables, the prompt, the query checker, the runner and the plain-English description. Pure functions, tested like the rest |
| `docs/data/countries.json` | Country codes → name, other names ("UK") and AviList region, made from Natural Earth by `tools/build-countries.js`, so questions can name countries |

- **Charts:** Chart.js from a public CDN, at a fixed version.
- **Region totals (changed 12 Nov):** a species counts towards a region if AviList's range text says it breeds there *or* winters or passes through on migration. Vagrants aren't counted (AviList doesn't record them), so Europe is about 550, not the ~1,000 of a full European list. "Seen" counts species seen anywhere, so the bars show overall progress towards each region's birds.
- **Map:** Leaflet with Natural Earth country outlines (public domain, pinned to release v5.1.2), as the spreadsheet's map already uses, with no tile background. Each country is also assigned to one AviList region (for the tooltips), following the range summariser's rules; countries spanning two regions (e.g. Russia, Egypt) go by continent.
- **Hosting:** GitHub Pages, from the `docs/` folder. The repo must be public.

## Data and privacy

- **The eBird file never leaves the visitor's computer.** Everything is worked out in the browser. Nothing is uploaded or stored on a server.
- To the AI (via Lyrebird): unmatched bird names and shortlists, and question text. Nothing else.
- Free-tier Gemini data may be used by Google to improve its products. The page says so next to both AI features. The AI only runs when someone clicks, never automatically.
- The sample data is my own list, including places. I'm happy for that to be public.
- Accepted name fixes are kept in the visitor's own browser (local storage), not sent anywhere.

## Licence and credit

AviList is © AviList Core Team, licensed under CC BY 4.0. The site footer and README give the recommended citation and a link to the licence, and say that the data was converted to a smaller format:

> AviList Core Team. 2026. AviList: The Global Avian Checklist, v2026. https://doi.org/10.2173/avilist.v2026

## Known limitations

- Shared daily AI cap: if many people use it on the same day, the AI features stop until the next day.
- Statuses only available in the spreadsheet (Captive, Introduced) aren't in the web version: every eBird species counts as seen.
- eBird's export has to be unzipped first (for now).
- The question tool can only answer questions that fit its fixed query shape. Others get "can't answer that" rather than a guess.

## How it will be tested

- Unit tests (`node --test`) for: the AviList conversion, the query checker (valid queries pass, invalid tables, fields, filters and types are rejected), the query runner on a small made-up list, and Lyrebird's request checks.
- The page previewed locally with my real eBird file and with sample data, at laptop and phone widths.
- AI: the 20-name Name Fixes accuracy test from `DESIGN.md`, and about 15 example questions, recording whether each was understood correctly.

## Build order (to have a working version by 18 Nov)

1. AviList data file, the site loading it, reading the eBird file, headline numbers. **Session 1.**
2. Charts (lifers, species and checklists per year and month), countries-birded map and region bars, unmatched names list. **Session 2 (done 11 Nov, with the changes above).**
3. Lyrebird plus Name Fixes in the browser. **Session 3 (built 11 Nov; tested with fake Google services, then deployed).**
4. Ask a question. **Session 4 (built 11 Nov; tested with a stand-in Lyrebird in the browser, then live after redeploying).**
5. Publish on GitHub Pages, README case study ("how I built this", including using Claude Code). **Session 5, or alongside 4.**

If time runs short, step 4 is the one to trim (fewer kinds of question), not the publishing.

## Decisions

1. Daily AI cap: 200 requests a day in total.
2. The repo will be made public so GitHub Pages can host the site.
3. "What's on it" agreed as above. Look: field-guide style (see "Look").
4. The sample data file in the repo keeps only the columns the dashboard needs (names, date, time, place, region, coordinates, checklist ID). Checklist comments, observation details and observer counts are removed, because they can contain other people's names and private notes.
