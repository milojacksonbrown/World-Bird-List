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
| Lifers over time | Chart of lifers per year, plus the latest 20 lifers (date, species, place, eBird checklist link) |
| Progress by region | A world map with each AviList region shaded by % of its breeding species seen (tap a region for numbers), plus the same figures as a compact bar list beside it. "Oceans" (seabirds) gets its own card, since it can't be shaded on land |
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
- Works on a phone as well as a laptop. A dark mode in the same style ("field guide by lamplight") follows the device setting.

## Where the data comes from

- **AviList v2026**, converted once on my computer into a compact data file that ships with the site: scientific and common names, order, family, IUCN category, eBird species code and breeding regions. Regions are worked out in advance with the existing range summariser, so the long range text doesn't need to be shipped.
- **The visitor's eBird file**, read in their browser using the existing functions from `LifeList.gs` (`parseCsvText_`, `summariseEbird_`, `resolveEbirdName_`). It's the same matching code as the spreadsheet, not a second copy.

## AI design

### The middleman

The Gemini key can't go in a public web page: anyone could copy it from the page source. A small, **separate** Apps Script project (not my spreadsheet's script) acts as a middleman:

- It holds the key in its Script Properties, like the spreadsheet does.
- It accepts two kinds of request: `nameFix` and `query`. Anything else is rejected.
- It calls Gemini and returns the reply.
- **Daily cap** (for example 200 requests a day in total). After that it says "AI limit reached for today", and the site keeps working without AI.
- It never stores requests and has no access to any spreadsheet.

### 1. Name Fixes assistant

The same method as `DESIGN.md`, split between the browser and the middleman:

| Step | Where |
|---|---|
| String matching and shortlist | Browser (existing code) |
| Ask Gemini to pick from the shortlist | Middleman |
| Check the answer is on the shortlist | Middleman **and** browser |
| Confidence (High / Medium / Low) | Browser (existing `decideSuggestion_`) |
| Accept | Browser; the fix is remembered in that browser |

Sent to the AI: the unmatched eBird name and the shortlist names only.

### 2. Ask a question

The AI doesn't answer the question. It translates it into a small, structured query, and the browser runs that query on the visitor's own data.

1. The browser sends the question plus a description of what can be searched: the tables (species, families, orders, regions, lifers), their fields, and the allowed filters, sorts and limits.
2. Gemini replies with a query in a fixed JSON shape, or "can't answer that".
3. The browser checks the query: every table, field and filter must be on the allowed list, and values must be the right type. Anything else is rejected with a message.
4. The browser runs the query and shows the results, plus a plain-English line saying how it was understood (for example "Families in Africa, % seen under 10%, lowest first"), so the person can spot a misreading.

**Sent to the AI:** the question text only. No sightings, names from the list, dates or places. The data never leaves the browser.

**Example questions it should handle:**
- Which families have I seen less than 10% of?
- How many lifers did I get in 2024?
- Which threatened species have I seen?
- What were my first 10 lifers in Asia?

## How it will be built

| Part | What it is |
|---|---|
| `docs/` | The website (GitHub Pages serves this folder): `index.html`, `app.js`, `styles.css` |
| `docs/data/avilist-v2026.json` | The converted checklist |
| `tools/build-avilist.js` | Converts the AviList download into that file (run on my computer with Node) |
| `tools/build-site.js` | Copies `LifeList.gs` and `NameFixesAssistant.gs` into the site as `.js` files, so both use the same code |
| `Middleman/Middleman.gs` | The middleman, pasted into its own Apps Script project and deployed as a web app (*Execute as: Me*, *Anyone*) |
| `Query.gs` *(or similar)* | The query checker and runner: pure functions, tested like the rest |

- **Charts:** Chart.js from a public CDN, at a fixed version.
- **Map:** Leaflet with Natural Earth country outlines (public domain), as the spreadsheet's map already uses. Each country is assigned to one AviList region with a small lookup table based on Natural Earth's continent and sub-region fields. Countries spanning two regions (e.g. Russia, Egypt) are given to one, which is noted under the map.
- **Hosting:** GitHub Pages, from the `docs/` folder. The repo must be public.

## Data and privacy

- **The eBird file never leaves the visitor's computer.** Everything is worked out in the browser. Nothing is uploaded or stored on a server.
- To the AI (via the middleman): unmatched bird names and shortlists, and question text. Nothing else.
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

- Unit tests (`node --test`) for: the AviList conversion, the query checker (valid queries pass, invalid tables, fields, filters and types are rejected), the query runner on a small made-up list, and the middleman's request checks.
- The page previewed locally with my real eBird file and with sample data, at laptop and phone widths.
- AI: the 20-name Name Fixes accuracy test from `DESIGN.md`, and about 15 example questions, recording whether each was understood correctly.

## Build order (to have a working version by 18 Nov)

1. AviList data file, the site loading it, reading the eBird file, headline numbers. **Session 1.**
2. Lifers chart, latest lifers, region progress map and bars, unmatched names list. **Session 2 (about 1.5 sessions).**
3. Middleman plus Name Fixes in the browser. **Session 3.**
4. Ask a question. **Session 4.**
5. Publish on GitHub Pages, README case study ("how I built this", including using Claude Code). **Session 5, or alongside 4.**

If time runs short, step 4 is the one to trim (fewer kinds of question), not the publishing.

## Decisions

1. Daily AI cap: 200 requests a day in total.
2. The repo will be made public so GitHub Pages can host the site.
3. "What's on it" agreed as above. Look: field-guide style (see "Look").
4. The sample data file in the repo keeps only the columns the dashboard needs (names, date, time, place, region, coordinates, checklist ID). Checklist comments, observation details and observer counts are removed, because they can contain other people's names and private notes.
