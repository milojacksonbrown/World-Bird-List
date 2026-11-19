# Life List: a field guide to your birds

A bird-watching life list that matches your [eBird](https://ebird.org) sightings to [AviList](https://www.avilist.org/), the new global checklist of the world's birds, with two AI features built so that the AI can't get things quietly wrong.

**[Try the dashboard →](https://milojacksonbrown.github.io/World-Bird-List/)**
Upload your own eBird data, or press *Try with sample data* to see mine.

It comes in two forms that share the same code:

| | Google Sheets version | Web dashboard |
|---|---|---|
| For | Me: a permanent, editable life list | Anyone with an eBird account |
| Data | Kept in my Google Drive, updated daily | Read in the visitor's browser, never uploaded |
| AI | Name Fixes assistant | Name Fixes, plus *Ask your list* |

![The Life List dashboard: field-guide styling with a dashed expedition route, upload and sample-data buttons, and headline counts of 640 species, 108 families, 26 orders and 9 countries](docs/screenshot.png)

---

## The problem

eBird and AviList don't always agree on what counts as a species. AviList might treat the Hooded Crow as part of the Carrion Crow, for example, or split one eBird species into two. Any eBird name with no exact AviList match falls out of the count until someone looks it up and fixes it by hand. That's slow, and typos are easy.

Life lists are also full of questions that a spreadsheet makes awkward to answer: *Which families have I barely touched? What was my best year? What have I seen in Thailand?*

## What it does

- **Bird names in 45 languages:** pick a language in the section bar and every bird's name in it appears beside the English one, in the lifer list, answers, fact files and the quiz (where typed answers in that language count too). From the IOC World Bird List's multilingual edition; species whose boundaries changed recently between IOC and AviList have English only.
- **Section buttons** at the top of the results jump to each part of the page; on wider screens they stay at the top of the window as you scroll, with the section you're reading highlighted.
- **The count:** species, families, orders and countries seen, as a share of the world's living birds, plus threatened species (IUCN Vulnerable or worse).
- **Where in the world:** a map of countries birded, shaded by the % of the species recorded there (eBird) that you've seen, and bars showing how much of each region's birds you've seen. Click a country to zoom into its states and provinces (counties in the UK, France, Ireland and Indonesia), shaded the same way, with species, lifers and the % of the species eBird has recorded there.
- **Through the years:** lifers and species by year and by month (for seasonality), with checklists as a guide to how much birding was done.
- **Latest lifers:** the first time each species was seen, newest first (the latest 10, then 50, 100 or all, with Show fewer at the top and bottom), with a search box and an illustrated sticker of each bird. Where a species has no sticker, a field-guide silhouette of its body shape (heron, wader, owl, finch…) stands in: all 250 AviList families are mapped to one of 32 shapes, and a test checks none is missing.
- **Explore:** click any country on Explore's own map, then a state or county (or pick from the lists, or click *Explore* beside a place on the main map) and see the birds reported there in the last 30 days that aren't on your list yet, grouped by family with when and where each was last reported: what you could find there now.
- **Quiz me on…:** type what you'd like to be quizzed on (*birds I saw in Thailand*, *my 2025 lifers*, *owls*) and the quiz uses just those birds, with every other setting (picture or sound, easy or hard) as usual. It reuses Ask your list: the AI turns the request into a search, the checker verifies it, and the page keeps it to species you've seen, refusing anything that isn't a group of birds.
- **Bird sounds:** fact files play each bird's song and call, from xeno-canto, credited to their recordists. 10,041 of 11,025 living species (91%) have a recording.
- **Test yourself:** a quiz on your own lifers, by picture or **by ear** (a song or call plays and you name the bird). For pictures, a sticker appears and you name the bird, choosing from four names or typing it. In *hard* mode the wrong answers are lookalikes from the same family (woodswallows against butcherbirds); typed answers accept any of the bird's names, American spellings, the scientific name, the name without its first word ("Bullfinch") when no other bird has that name, and small spelling slips (one letter in eight). Ten birds a round, with the ones you missed to look at again and your best score kept in your browser.
- **Your birds around the page:** once your file loads, 25 of your lifers, picked at random each time, appear as stickers around the title, down the margins and by the footer, in fixed places chosen never to cover the text. Click one for its fact file. A switch under the title chooses **your lifers** or **all birds** (any of the world's 11,000), remembered in your browser, and **Shuffle** picks a new set. A "click me" arrow points at the first sticker on each visit, until you click one.
- **Fact files:** click any bird, in the lifer list or an answer, for its fact file: a large illustration, AviList's description of where it lives, a seasonal range map, its IUCN status (colour-coded, green for Least Concern through to red for Critically Endangered), a size comparison (the bird to scale beside a person, or a hand if it's 20 cm or less), size and life history (each fact labelled with its source), your own records, and links to eBird and Bird Album.
- **Names to check:** every eBird name that doesn't match AviList, with an AI-assisted suggestion you can accept, change or ignore.
- **Ask your list:** questions in plain English, answered from your own data, with the same silhouettes beside species, families and orders. It goes down to states, provinces and counties too: *Which county have I seen the most species in? What have I seen in Suffolk? My first lifer in each Australian state?* And it knows each bird's size, range, habitat, diet, altitude, eggs and nest, from two scientific datasets: *What's the heaviest bird I've seen? Which of my birds have the smallest ranges? What nectar feeders have I seen?* Each habitat and nest type gets a small line drawing (forest, wetland, coast…; cup, burrow, pendant…).

![The map zoomed into the United Kingdom: counties shaded by species seen, beside bars such as London 76 of 382 species (19.9%) and North Yorkshire 54 of 408 (13.2%)](docs/screenshot-uk-counties.png)

*Clicking the United Kingdom: each county is shaded by species seen, and the bars show the share of the species ever recorded there.*

The species totals come from eBird's API. A small tool (`tools/fetch-region-totals.js`) asked for every country, state and county once, about 4,300 requests, and saved only the counts (52 KB). The site reads that file, so visitors never call eBird and my key isn't needed or exposed.

## The AI features, and how they're kept honest

Both features follow one rule: **the AI proposes, ordinary code verifies.** The AI never edits data and never answers from its own memory. It makes a choice from a fixed set of options, and code checks that choice before anything happens.

### 1. Name Fixes assistant

1. **String matching first, no AI.** The unmatched name is compared with all 11,000 AviList names, ignoring case, accents, hyphens and spelling variants (Grey/Gray). Near-identical matches are settled here, for free.
2. **AviList's own answer, no AI.** Many names eBird treats as a species but AviList doesn't are listed in AviList as a *subspecies*. eBird's Hooded Crow (*Corvus cornix*) is AviList's *Corvus corone **cornix***, part of Carrion Crow. If exactly one species in the genus has a subspecies of that name, that's the answer, with High confidence and the reason shown. This solved every unmatched name in my own eBird data, instantly.
3. **A shortlist** (only if there's still no answer). The 10 most similar names, plus 5 species from the same genus.
4. **The AI picks from the shortlist, or says "none".** It sees only bird names. Any answer that isn't a shortlist number is rejected.
5. **Confidence comes from agreement, not from the AI.** It's *High* when string matching and the AI agree, *Medium* when only one method finds a match, and *Low* when they disagree. AI models are poor judges of their own certainty, so I don't ask the AI how sure it is.
6. **Nothing changes until I accept.** I can also pick any other candidate, or search AviList myself.

Example: for *Hooded Crow (Corvus cornix)*, string matching guesses Common Raven (same genus, similar letters). Before step 2 existed, Gemini picked Carrion Crow, which is right, but because the two methods disagreed the suggestion was only **Low** confidence. A smaller backup model got it wrong. Step 2 now finds the answer in AviList's own subspecies list: instant, free and certain.

**Lesson: the best AI feature can be less AI.** The AI is now only used for the rare names that the data can't settle.

### 2. Ask your list

The AI doesn't answer the question. It **translates it into a small, structured query**, and the browser runs that on the visitor's data.

```
"Which families have I seen less than 10% of?"
      ↓  the AI model (sees the question only)
{ "table": "families", "filters": [{ "field": "pctSeen", "op": "lt", "value": "10" }],
  "sortField": "pctSeen", "sortDir": "asc" }
      ↓  checked against a list of allowed tables, fields, comparisons and value types
      ↓  run in the browser on the visitor's own data
A table of families, plus: "Understood as: Families where % seen is under 10%, lowest first"
```

- **Your data never leaves your computer.** Only the question is sent; no sightings, places or dates.
- **The query is checked twice**, in Lyrebird (below) and again in the browser, so a faulty or tampered reply can't run anything else.
- **"Understood as…"** shows how the question was read, so a misreading is visible instead of hidden behind a confident-looking answer.
- **One source of truth.** The allowed tables live in one place (`ASK_TABLES_`). The prompt, the checker and the plain-English description are all generated from it, so they can't drift apart.
- **It says when it can't answer.** A question it can't handle ("What did I see at Hyde Park last weekend?") gets a reason instead of a guess.

### Lyrebird: keeping the API key secret

A public website can't contain an API key, because anyone could copy it. So the site talks to **Lyrebird**, a small Google Apps Script web app I run. Lyrebird holds the API keys, accepts only two kinds of request with strict size limits, checks the AI's answers, and has a **daily cap** of 200 AI calls shared by everyone. It stores nothing except that day's count. (It's named after the bird that passes on sounds it has heard.)

**Two AI companies, one fallback.** Lyrebird asks OpenAI's open GPT-OSS 120B model, run free by [Groq](https://groq.com), first. If Groq is out of quota or down, it asks Google's Gemini 3 Flash instead. Each company has its own key, quota and servers, so one failing doesn't take the AI down. The order is a single setting in Lyrebird (`AI_MODELS`), every model's answers go through exactly the same checks, and the site says when a backup answered.

If both models are unavailable or the cap is reached, **the rest of the site keeps working**: string matching still suggests fixes, and only the AI parts pause.

## Explore: what you could see there now

eBird's API can say which species have been reported in a place in the last 30 days, for any country, state or county. That's a live answer to "what's around at this time of year", without the all-time vagrants a full species list would include.

- **Through Lyrebird, so the key stays private.** Lyrebird has a third job, `recent`, separate from the AI: it takes an eBird region code (checked against a strict pattern), adds the eBird key from its settings, and passes on only the species code, the last date, and the place name unless eBird marks it private (often someone's garden).
- **Polite to eBird.** Each place's answer is remembered for an hour (Apps Script's cache), so repeated clicks don't call eBird again, and Explore has its own daily cap, separate from the AI's.

**Speed, measured before changing anything.** When the site started to feel slow, the obvious guess (more data for the AI to go through) was wrong: the AI never reads anyone's data. Timing it on the live site showed where the waits were, and each got its own fix:

| Wait | Before | Fix | After |
|---|---|---|---|
| First fact file | about 1 s, for 6.8 MB of data files (about 1 MB compressed) | Fetched in the background once the dashboard shows; the range text and sounds slot in when they arrive, never holding the fact file up | about 0.1 s |
| A range map | 2–3 s, while GBIF builds the map on request | Maps already drawn are remembered in the browser (the 40 most recent, for a month) | instant the second time |
| Lyrebird | about 1.4 s for Google to answer at all, plus 2–3 s for the AI | A wake-up visit when the dashboard shows (no AI, nothing counted), and a question already asked that day is answered from memory without the AI | the AI's wait is gone for repeated questions (the example buttons, say) |

Country clicks were already quick (about 0.25 s; each country's outlines are a separate small file).
- **A bug worth remembering.** Lyrebird tidies away old daily counters by name, and Explore's counter was called `EBIRD_` + date, so the tidy-up also deleted `EBIRD_API_KEY`: each time the key was added, one request worked and then it vanished. The tidy-up now only removes names that are a prefix followed by a date, the counter is called `RECENT_`, and a test checks the keys survive.
- **Matched by eBird's own codes.** AviList records the eBird code for every species, so eBird's answer maps straight onto your list; the page then lists the species you haven't seen, by family, in checklist order.
- **Its own map, so anywhere can be explored.** The main map is about your list, so Explore has a separate one: every country is clickable, then its states and provinces (the same Natural Earth shapes the main map zooms into), and in the UK, France, Ireland and Indonesia a second level of counties. Natural Earth's state codes are the international ISO ones eBird uses too, so they match directly (Victoria is `AU-VIC`, California `US-CA`); the rest, and counties, are matched by name (Finistère is `FR-BRE-29`).
- **The right codes for places.** The place picker uses eBird's own country, state and county codes, saved during the region-totals run (`tools/build-explore-regions.js`). The map's county shapes come from Natural Earth, with different codes, so the map's *Explore* links match counties to eBird's by name.

## Bird sounds

Fact files play a bird's song and call, and the quiz can play one for you to name. The recordings are from [xeno-canto](https://xeno-canto.org), the open library where birders share recordings, each under a Creative Commons licence chosen by its recordist.

- **Fetched once, streamed when played.** `tools/fetch-sounds.js` asked xeno-canto's API for every living species' best-rated recordings and kept two (a song and a call, if both exist): 19,818 recordings for 10,041 species, 91% of them. Only the details are saved (`docs/data/sounds.json`: about 500 KB compressed, loaded the first time it's needed); the audio streams from xeno-canto.
- **The API key never leaves my computer.** xeno-canto's API needs a personal key; the tool asks for it in the terminal without showing it, uses it only while it runs, and never saves it. Like the eBird totals, it's polite (about one request a second, slowing down if asked) and resumable, which mattered: the run took several hours.
- **Credits as the licences require.** Most recordings are CC BY-NC-SA or BY-NC-ND (non-commercial, fine for this free site). Each player shows the XC number, the recordist and the licence, linked; the 29 recordings returned without a licence are left out. In the sound quiz, the link to the recording (which names the species) only appears after you answer.
- **A second pass under older names.** AviList 2026 has moved some species to new genera, but xeno-canto still files them under their old names (e.g. *Aerospiza tachiro* is *Accipiter tachiro* there). A second pass (`--other-names`) searched the species that found nothing under their IOC, eBird and BirdLife names, from BIRDBASE, and found recordings for 235 more.
- **Some birds are deliberately left silent.** Of the 984 species still without a recording, 236 are threatened. xeno-canto restricts recordings of species at risk from trapping or from people playing calls to lure them out, so their sounds aren't freely downloadable: a conservation safeguard the site respects rather than works around. The rest have rarely or never been recorded.
- **A lesson on handling keys.** The first attempt at loading the key pasted it onto the end of a command, where it showed up in an error message. The tool now asks for the key itself, hidden, so it can't end up in a command or the shell history; a key that has been exposed gets replaced.

## Stickers and fact files

Every bird has an illustrated sticker from [huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker) (by Huashu, for the [Bird Album](https://birdalbum.com) guide), which follows AviList v2026 like this site, so the names match exactly: **11,007 of the 11,025 living species** have one. The 18 without are birds AviList flags as possibly extinct.

- **Licence:** CC BY 4.0, so they can be used and resized with credit. The credit is under every large picture and in the footer.
- **AI-generated, and labelled so.** The stickers are AI illustrations, which their author marks as not checked by experts. The fact file says "AI illustration" beside each one. Most were drawn from a reference photo whose rights stay with the photographer; the photos aren't distributed, and the project has a takedown process.
- **Pinned to one version.** The library changed licence on 5 Nov 2026 (to CC BY, from a more restrictive one), so the site uses one exact commit (`3b42ef8`, v2.3.6), not "latest": the pictures can't change or disappear under it.
- **Small icons, full pictures only when asked.** Each sticker is about 75 KB, so a 25-row answer would cost 2 MB just for icons. `tools/build-factfiles.js` makes a 96-pixel copy of each (about 2 KB, 23 MB for all 11,000), kept with the site and loaded only as they scroll into view. The full sticker loads from the pinned CDN only when a fact file opens. If a sticker is missing or fails to load, the family silhouette is shown instead.
- **AviList's range text** ("Breeds in…") is in a separate file loaded the first time a fact file opens, so it doesn't slow the page down.

**Range maps, from open data.** Apps like Merlin draw range maps from licensed sources that can't be republished. Instead, the fact file asks [GBIF](https://www.gbif.org), the open global database of species records, where eBird users recorded the species in **June–July** and in **December–January**, and colours each grid cell like a field guide: warm for June–July, blue for December–January, purple for **year-round** (recorded in both), with your own sightings as green dots. It says "June–July", not "breeding season", because June is winter in the southern hemisphere. Details:
- GBIF sends the records as *vector tiles* (a compact binary format). Rather than add a mapping library, the site decodes them with a small, tested reader (`readMvtPoints_`) and draws the map as SVG in the page's own colours.
- **eBird's records only.** GBIF pools hundreds of sources, and some let errors through. The first maps showed Hobbies year-round in Britain and France: GBIF holds 181 British winter records (against 24,975 in summer), mostly from local record centres and a casual birding app, many decades old, and a third of France's 300 came from one atlas batch in a single year: mistaken identities and wrong dates. eBird's reviewers check unusual sightings, and its data on GBIF has only 2 British winter Hobbies. So the map asks GBIF for the eBird dataset alone, and falls back to every source only for a species eBird has no records of (the credit under the map says which).
- **A season has to hold its own in each cell.** A cell is year-round only if its quieter season has at least a tenth as many records as its busier one; 8 winter records beside 3,000 summer ones make a summer cell.
- For common birds, cells with only a handful of records are left out, so one stray doesn't look like part of the range. The map is framed on the middle 95% of the cells, not of the records: counting records centred the bullfinch on Europe, where most birdwatchers are, and cut off its range across Asia to Japan.
- These are *records*, not a modelled range: well-watched places look fuller than remote ones, and introduced and escaped birds appear too (Java Sparrow shows up on four continents).
- **When GBIF doesn't know the name.** Checklists disagree on names, and GBIF follows older ones. Checking all 11,025 living AviList species against GBIF found 337 (3%) it didn't recognise, so their fact files had no map. `tools/build-other-names.js` sorted them out, and the page now tries the other name it found:
  - **5 names that are also plants or insects** (*Chloris chloris*, the European Greenfinch, is also a grass): asked again as a bird.
  - **220 renamings and spellings** the same bird goes by on GBIF: Musk Lorikeet is *Glossopsitta concinna* there, not AviList's *Trichoglossus concinnus*; Kakapo is *Strigops habroptila*, not *habroptilus*; AviList 2026 moved eleven African and Asian buntings out of *Emberiza*. Found from BIRDBASE's names in other checklists, GBIF's near-spellings (same genus, a couple of letters apart), or a species with the same second name in the same family, but only if GBIF's English name is the same kind of bird: without that check, a *Myophonus* whistling thrush was matched to a flycatcher with the same second name.
  - **92 recent splits** GBIF still files under the species they were split from (Little Heron under Striated Heron, *Butorides striata*, found because GBIF lists it as a subspecies). The map doesn't borrow the parent's range, which would put the Little Heron in South America; the fact file says why there's no map, and why there are no measurements.
  - **20 not found** either way.

**Size comparisons, from an estimate.** None of the datasets give a bird's length (beak tip to tail tip), so the fact file estimates it: beak + tail + a body length from weight (which grows with the cube root of weight), with more for long-necked shapes such as herons, swans and flamingos. On 28 birds of known length it's typically within 6%; the worst is the Mute Swan, 22% short. The bird's sticker is drawn to scale beside a person, or beside a hand for birds of 20 cm or less. Each sticker is measured (where the bird sits in its transparent picture, and the picture's real shape) so the bird stands on the line and its own length, not the picture's, is to scale.

## Bird traits: two scientific datasets, combined carefully

"Ask your list" can answer questions about size, range, habitat and diet because every species is joined to two published, peer-reviewed datasets (both CC BY 4.0):

- **[AVONET](https://doi.org/10.1111/ele.13898)** (Tobias et al. 2022): measurements of 90,000 museum specimens (weight, wing, tail and beak length), lifestyle, migration, and range size from BirdLife's range maps.
- **[BIRDBASE](https://doi.org/10.1038/s41597-025-05615-3)** (Şekercioğlu et al. 2025): 78 traits from the literature, including main habitat and diet, altitude, island breeding, flightlessness, clutch size and nest type.

A small tool (`tools/build-traits.js`) joins them to AviList and writes one compact file for the site (860 KB, about 290 KB compressed). Decisions worth explaining:

- **One source per field, except where the two measure the same thing.** Weight comes from AVONET, and from BIRDBASE only where AVONET has none: both are average body mass in grams, and each answer can show which dataset it came from. Habitat and diet come from BIRDBASE only, because the two datasets define them differently, and mixing them would quietly make "insect-eaters" mean different things for different birds.
- **Matching names across taxonomies.** AVONET uses 2021 names; AviList is 2026. BIRDBASE lists each species' BirdLife, eBird and AviList names side by side, so it doubles as a translation table: 9,840 species matched AVONET directly, 873 more through BIRDBASE or AVONET's eBird sheet. **97% of living species have AVONET data and 99% have BIRDBASE data.** The gaps are mostly species split since 2021, which the datasets still measure together with the species they were split from; their fact files say so. AviList 2026 renamings that BIRDBASE (made for AviList 2025) doesn't know yet are matched through `docs/data/other-names.json` (see range maps). Full report: [`Tests/trait-coverage.md`](Tests/trait-coverage.md).
- **Unknown stays unknown.** A species with no value is left blank and never counted as matching (it isn't "under 100 g" just because its weight is missing), and sorts last.
- **What testing found.** On my own list, "smallest range" came back with Australasian Gannet first, at 10,000 km², for a bird seen across the Tasman Sea. AVONET's range is where a species *breeds or lives all year*, which for a seabird is mostly its colonies. The AI's description of the field now says so. Values are kept as published rather than corrected by hand.

## Testing

- **151 automated tests** (`node --test`) cover:
  - the AviList conversion and name matching
  - the confidence rules
  - the dashboard's numbers
  - Lyrebird's request checks, run against fake Google services, so no real key or internet is needed
  - the query checker, which has to reject unknown tables and fields, the wrong value types, and tampered replies
  - the fact files: every fact labelled with its source, unknown facts left out, made-up checklist IDs not linked, and a thumbnail present for every species with a sticker
  - the range map: reading GBIF's vector tiles (from a tile built by hand in the test), grid cells, the projection, sorting by season (a few off-season records don't make a cell year-round), leaving out strays, and framing
  - Explore: Lyrebird's `recent` job (one entry per species, private places left out, the key in a header, an hour's memory, its own daily cap, bad region codes refused), and turning eBird's answer into the species you haven't seen, by family
  - the quiz: lookalike wrong answers, and which typed answers count (spellings, other names, slips, short names) and which don't
  - a syntax check on the page's own scripts
  - the trait data: unpacking the compact file, filtering and sorting by weight, habitat, diet and nest, and unknown values never matching
  - a check that the website's copies of the shared code are up to date
  - a check that every AviList family has a silhouette, so a new AviList edition can't quietly leave a bird without one
- **A coverage check for Name Fixes** (`tools/check-ebird-coverage.js`) runs every one of eBird's 11,201 species names, and 4,700 subspecies groups and forms, through the matching with no AI. **99.9% are settled without AI**: 11,168 match AviList directly, and 21 more through AviList's subspecies list (all 21 checked by hand). The 12 left over are all extinct birds that AviList's list leaves out, so every living bird eBird recognises is matched with no AI. Full report: [`Tests/ebird-coverage.md`](Tests/ebird-coverage.md).
  - **It found a real bug.** The eBird reader skipped any name containing "domestic" or "hybrid", meant for farmyard ducks and hybrids. But that also threw away **House Sparrow** (*Passer domesticus*), **Whiskered Tern** (*Chlidonias hybrida*) and Kelp Goose (*Chloephaga hybrida*). My own list was two species short (638, not 640). It now matches eBird's exact labels, "(Domestic type)" and "(hybrid)", and tests cover all three birds.
- **An accuracy check for Ask your list** (`tools/check-questions.js`) sends 16 realistic questions to the live AI and records whether each was understood correctly, including two it *should* refuse. I ran the same questions on two models:

| Model | Understood correctly | Rejected by the checker | Google server errors | Typical answer time |
|---|---|---|---|---|
| **GPT-OSS 120B on Groq**, the default | **16 of 16** (and 18 of 18 with two newer questions) | 0 | 0 | about 2.5 s |
| Gemini 3 Flash (preview), the backup | 14 of 16 | 1 | 1 | about 3 s |
| Gemma 4 26B (Google's open model), tried and dropped | 10 of 16 | 3 | 3 | 4 to 80 s |

Full results: [Groq](Tests/question-accuracy-groq.md), [Flash](Tests/question-accuracy.md), [Gemma](Tests/question-accuracy-gemma.md), and a [live run with the fallback switched on](Tests/question-accuracy-fallback.md) (Flash out of quota, so Gemma answered 14 of 16; 12 right, the rest refused by the checker). **No wrong answer reached the screen with any model.** Every malformed query was caught by the checker. Gemma's failures included field names with stray Russian and Arabic words or a leftover token (`<unused694>seen`) in them, and an invented field (`tourist_count_of_species_per_country`). It also sometimes repeats itself in its explanations ("…ls-ls-ls-ls"), which is why the site labels backup answers "worth a closer look". Gemma was usable as a backup in theory, but in practice its answers were too often unhelpful, so I replaced it. GPT-OSS 120B on Groq got all 16 right. It's a much bigger model, and Groq can *guarantee* the reply matches the required format ("strict" structured output). Its free tier also allows far more requests than Gemini Flash's.

**What testing found.** On the first live run, Gemini chose the right table every time but dropped the filters and sorting. I'd marked those parts of the reply as *optional*, and the model leaves optional keys out when it's forced to reply in JSON. Making every key required, with explicit "none" values, fixed it, and a test now guards against it coming back. The checker caught every malformed query, so nothing wrong was ever run.

The free Gemini tier turned out to be the real constraint, more than the code. On the same day:
- the preview model ran out of quota;
- an older model was unavailable to new API keys;
- a newer one was overloaded.

That's why Lyrebird falls back to a second model, and why the site keeps working without the AI.

## Privacy

- Your eBird file is read in your browser and never uploaded.
- The AI is sent only bird names (Name Fixes) or your question (Ask your list).
- Accepted name fixes are saved in your own browser only.
- Free AI services may keep or use what's sent (Google says so for Gemini's free tier), so nothing personal is sent.
- The sample data on the site is my own list, with comments, counts and observer details removed, dropped-pin addresses blurred to suburb level (about 1 km), and checklist IDs replaced, since eBird checklists are public and show exact locations. The repo's history was rewritten before publishing, so the exact addresses were never public.

## How I built this

I built this with [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant, as a learning project. My role was the product and the decisions:
- what the tool should do, and for whom;
- the design documents ([`DESIGN.md`](DESIGN.md), [`DASHBOARD-DESIGN.md`](DASHBOARD-DESIGN.md)), agreed before any code was written;
- the look (a field guide), and what counts as a correct answer;
- testing everything in the real spreadsheet and browser, and pushing back when results were wrong.

Claude Code wrote most of the code and explained each change in plain English before making it. The commit messages explain each change too.

Some things I learned along the way:
- **Design the AI's job to be checkable.** "Choose from this list" and "fill in this form" can be verified by code. "Tell me the answer" can't.
- **Don't trust a model's confidence in itself.** Measure agreement between independent methods instead.
- **Test against the live model, not just mocks.** The optional-keys problem only showed up with real Gemini replies.
- **Test against the whole reference list, not just your own data.** Running all 11,201 eBird names found a bug that my own 2,200 records had hidden in plain sight.
- **Measure before choosing a model.** The same 16 questions on three models gave a clear answer (16, 14 and 10 of 16), instead of a guess. Switching company took one small code change, because all AI calls go through one function and every answer is checked the same way.
- **Don't depend on one provider.** Free tiers run out, get busy and withdraw models. Two companies in a fallback chain keep the feature working.
- **Plan for the free tier failing.** Rate limits, withdrawn models and busy servers are normal, so the product should still work without the AI.
- **Be polite to free APIs, and make long jobs resumable.** eBird answered "too many requests" (HTTP 429) when the totals tool asked too fast. It now sends one request at a time, pauses and slows down when refused, and caches every answer, so a stopped run carries on where it left off.
- **Make a chart answer the reader's question.** Bars scaled to my best region made Victoria look complete when I'd seen 30% of its birds. Showing species seen out of the total recorded fixed it.
- **Keep secrets out of code**: API keys live in Script Properties, behind a middleman with a spending cap.

## Project layout

| Path | What it is |
|---|---|
| `LifeList.gs` | The Google Sheets version: builds the tabs, reads eBird data, matches names, runs daily |
| `NameFixesAssistant.gs` | Name matching, shortlist, confidence rules and the AI call to Groq or Google (shared by the sheet, Lyrebird and the website) |
| `AskYourList.gs` | The question tool: allowed tables, prompt, query checker, runner and description (shared) |
| `Lyrebird/Lyrebird.gs` | The AI middleman web app |
| `tools/build-traits.js` | Joins AVONET and BIRDBASE to AviList (weight, range, habitat, diet, nests…) and writes the coverage report |
| `tools/build-explore-regions.js` | Every country, state and county with its eBird code, for Explore's place picker |
| `tools/build-other-names.js` | The names GBIF uses for AviList species it doesn't know by name (renamings, spellings) and the species recent splits are still filed under, for range maps and traits |
| `tools/fetch-sounds.js` | Fetches two recordings' details (song and call) per species from xeno-canto, resumably; `--rebuild` rewrites the file from the saved answers |
| `tools/build-names.js` | Builds one file of bird names per language (45) for the language picker |
| `tools/build-factfiles.js` | Builds the sticker thumbnails, the sticker index and AviList's range text for the fact files |
| `docs/js/nest-icons.js` | A line drawing for each of BIRDBASE's nest types (none for "No nest" or "Other bird's nest") |
| `docs/js/habitat-icons.js` | A line drawing for each of BIRDBASE's 14 main habitats, shown beside habitats in answers |
| `docs/js/bird-icons.js` | The body-shape silhouettes: which shape each family gets, and the numbers each shape is drawn from |
| `docs/` | The website, served by GitHub Pages. `docs/lib/` holds generated copies of the shared `.gs` files |
| `tools/` | Scripts run on my computer: convert AviList, copy shared code to the site, build country names and state/province outlines, fetch regional species totals from eBird, run the accuracy and coverage checks |
| `Tests/` | Automated tests and accuracy results |

### Running it locally

```bash
node --test
```

```bash
python3 -m http.server 8765 --directory docs
```

Then open http://localhost:8765. After changing a shared `.gs` file, run `node tools/build-site.js` to update the website's copies.

### Setting up the Google Sheets version

Follow the instructions at the top of [`LifeList.gs`](LifeList.gs), or the [setup guide](Documents/Bird-List-Setup-Guide.pdf). For the AI suggestions, add `NameFixesAssistant.gs` as a second script file and put a [Gemini API key](https://aistudio.google.com/apikey) in **Project Settings ▸ Script Properties** as `GEMINI_API_KEY`.

## Credits

- **Checklist:** AviList Core Team. 2026. *AviList: The Global Avian Checklist, v2026.* https://doi.org/10.2173/avilist.v2026. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and converted to a smaller format for this site.
- **Sightings and regional species totals:** [eBird](https://ebird.org) (Cornell Lab of Ornithology). This project isn't affiliated with eBird or AviList.
- **Map:** country and state/province outlines from [Natural Earth](https://www.naturalearthdata.com/) (public domain), drawn with [Leaflet](https://leafletjs.com/). **Charts:** [Chart.js](https://www.chartjs.org/).
- **Bird names in other languages:** IOC World Bird List v15.2, multilingual edition (Gill, F., D. Donsker & P. Rasmussen, Eds), CC BY 3.0, via huashu-bird-sticker. One file per language (`tools/build-names.js`), loaded only when chosen.
- **Recent sightings (Explore):** [eBird](https://ebird.org), Cornell Lab of Ornithology, through its API.
- **Bird sounds:** [xeno-canto](https://xeno-canto.org), each recording by its recordist under its Creative Commons licence (credited beside each player).
- **Range maps:** eBird's occurrence records (the eBird Observation Dataset), via [GBIF.org](https://www.gbif.org), fetched when a fact file opens.
- **Bird illustrations:** [huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker) v2.3.6 by Huashu (Bird Album), CC BY 4.0. AI-generated; resized for the icons.
- **Bird traits:** AVONET (Tobias, J.A. et al. 2022, *Ecology Letters* 25: 581–597, https://doi.org/10.1111/ele.13898) and BIRDBASE v2025.1 (Şekercioğlu, Ç.H. et al. 2025, *Scientific Data*, https://doi.org/10.1038/s41597-025-05615-3), both CC BY 4.0, joined to AviList and converted to a smaller format.
- **AI:** OpenAI's GPT-OSS 120B on Groq, with Google Gemini as the backup, through Lyrebird.
