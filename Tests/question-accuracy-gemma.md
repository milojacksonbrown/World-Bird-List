# Ask your list: accuracy check (Gemma 4, for comparison)

Run on 2026-11-11 against Lyrebird version 2026-11-11 (session 4b) (10 of 16 understood as expected).
Model: `gemma-4-26b-a4b-it` (set in Lyrebird's GEMINI_MODEL script property).
Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.

| Question | Counts as right | Understood as | Right? |
|---|---|---|---|
| Which families have I seen less than 10% of? | families, % seen under 10 | Families where % seen is under 10%, % seen lowest first, up to 25. | Yes |
| How many lifers did I get in 2024? | lifers first seen in 2024 (species or years table) | Error: Gemini error 500: Internal error encountered. | **No** |
| Which threatened species have I seen? | seen and threatened | invalid: The species table has no field " состояния_seen". | **No** |
| What were my first 10 lifers in Asia? | seen, Asia, oldest first, 10 | Species that breed in Asia that I've seen and whose regions include Asia, first seen oldest first, up to 10. | Yes |
| Which year did I get the most lifers? | years by lifers, highest first | Years, lifers highest first, up to 1. | Yes |
| Which month do I see the most species in? | months by species, highest first | Months, species highest first, up to 1. | Yes |
| Which owls have I seen? | seen, family contains "owl" | Error: Gemini error 500: Internal error encountered. | **No** |
| Which country have I seen the most species in? | countries by species, highest first | Countries, species highest first, up to 1. | Yes |
| What have I seen in Thailand? | species recorded in Thailand | Species that I've seen and whose countries include Thailand, first seen newest first, up to 25. | Yes |
| Which orders haven't I seen anything from? | orders with none seen | invalid: The value "false" doesn't suit seen (number). | **No** |
| Which families have I seen every species of? | families with all seen | Families where % seen is 100%, seen highest first, up to 25. | Yes |
| What endangered birds in Australasia haven't I seen yet? | not seen, Australasia, Endangered (or threatened) | Species that breed in Australasia where iucn is “EN” and that I haven't seen, first seen newest first, up to 25. | Yes |
| Show my lifers from March 2026 | seen, first seen in March 2026 | Species that I've seen and month first seen is 3 and year first seen is 2026, first seen oldest first, up to 25. | Yes |
| Which hummingbirds have I seen? | seen, family contains "hummingbird" | Error: Gemini error 500: Internal error encountered. | **No** |
| What did I see at Hyde Park last weekend? | cannot (places below country, trips) | cannot: Questions about specific locations like Hyde Park are not in the tables; try asking about a year or a month. | Yes |
| Which species have I seen in only one country? | cannot (needs two steps) | invalid: The species table has no field "tourist_count_of_species_per_country". | **No** |
