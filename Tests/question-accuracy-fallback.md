# Ask your list: accuracy check (live fallback, Flash and Gemma mixed)

Run on 2026-11-12 against Lyrebird version 2026-11-12 (session 4d) (11 of 16 by the script; 12 of 16 on review, see note).
Flash was mostly out of free quota, so Gemma 4 answered 14 of the 16 (see "Answered by").
Note: "Show my lifers from March 2026" was marked wrong because the query had no "seen" filter, but only seen species have a first-seen year, so the answer is right. The check has since been corrected.
Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.

| Question | Counts as right | Understood as | Answered by | Right? |
|---|---|---|---|---|
| Which families have I seen less than 10% of? | families, % seen under 10 | Families where % seen is under 10%, % seen lowest first, up to 25. | gemma-4-26b-a4b-it (backup) | Yes |
| How many lifers did I get in 2024? | lifers first seen in 2024 (species or years table) | Years where year is 2024, year lowest first, up to 25. | gemma-4-26b-a4b-it (backup) | Yes |
| Which threatened species have I seen? | seen and threatened | Species that are threatened and that I've seen, first seen newest first, up to 25. | gemma-4-26b-a4b-it (backup) | Yes |
| What were my first 10 lifers in Asia? | seen, Asia, oldest first, 10 | Species that breed in Asia that I've seen, first seen oldest first, up to 10. | gemma-4-26b-a4b-it (backup) | Yes |
| Which year did I get the most lifers? | years by lifers, highest first | Years, lifers highest first, up to 1. | gemma-4-26b-a4b-it (backup) | Yes |
| Which month do I see the most species in? | months by species, highest first | Months, species highest first, up to 1. | gemini-3-flash-preview | Yes |
| Which owls have I seen? | seen, family contains "owl" | invalid: The species table has no field "<unused694>seen". | gemma-4-26b-a4b-it (backup) | **No** |
| Which country have I seen the most species in? | countries by species, highest first | Countries where species is over 0, species highest first, up to 1. | gemma-4-26b-a4b-it (backup) | Yes |
| What have I seen in Thailand? | species recorded in Thailand | Species that I've seen and whose countries include Thailand, first seen newest first, up to 25. | gemma-4-26b-a4b-it (backup) | Yes |
| Which orders haven't I seen anything from? | orders with none seen | invalid: The value "false" doesn't suit seen (number). | gemma-4-26b-a4b-it (backup) | **No** |
| Which families have I seen every species of? | families with all seen | Families where % seen is 100%, family A to Z, up to 25. | gemini-3-flash-preview | Yes |
| What endangered birds in Australasia haven't I seen yet? | not seen, Australasia, Endangered (or threatened) | Species that breed in Australasia where iucn is “EN” and that I haven't seen, first seen newest first, up to 25. | gemma-4-26b-a4b-it (backup) | Yes |
| Show my lifers from March 2026 | seen, first seen in March 2026 | Species where year first seen is 2026 and month first seen is 3, first seen oldest first, up to 25. | gemini-3-flash-preview | **No** |
| Which hummingbirds have I seen? | seen, family contains "hummingbird" | invalid: The species table has no field "بحث_field". | gemma-4-26b-a4b-it (backup) | **No** |
| What did I see at Hyde Park last weekend? | cannot (places below country, trips) | cannot: Questions about specific locations like Hyde Park or specific days/trips are not in the tables. | gemma-4-26b-a4b-it (backup) | Yes |
| Which species have I seen in only one country? | cannot (needs two steps) | invalid: Can't use "eq" on countries. | gemma-4-26b-a4b-it (backup) | **No** |
