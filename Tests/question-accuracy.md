# Ask your list: accuracy check

Run on 2026-11-12 against Lyrebird version 2026-11-11 (session 4b) (14 of 16 understood as expected).
Model: `gemini-3-flash-preview` (Lyrebird's default). For comparison, the same questions on Gemma 4: [question-accuracy-gemma.md](question-accuracy-gemma.md).
Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.

| Question | Counts as right | Understood as | Right? |
|---|---|---|---|
| Which families have I seen less than 10% of? | families, % seen under 10 | Families where % seen is under 10%, % seen lowest first, up to 25. | Yes |
| How many lifers did I get in 2024? | lifers first seen in 2024 (species or years table) | Years where year is 2024, year lowest first, up to 25. | Yes |
| Which threatened species have I seen? | seen and threatened | Species that are threatened and that I've seen, first seen newest first, up to 25. | Yes |
| What were my first 10 lifers in Asia? | seen, Asia, oldest first, 10 | Species that breed in Asia that I've seen, first seen oldest first, up to 10. | Yes |
| Which year did I get the most lifers? | years by lifers, highest first | Years, lifers highest first, up to 1. | Yes |
| Which month do I see the most species in? | months by species, highest first | Months, species highest first, up to 1. | Yes |
| Which owls have I seen? | seen, family contains "owl" | Species where family contains “Owls” and that I've seen, first seen newest first, up to 25. | Yes |
| Which country have I seen the most species in? | countries by species, highest first | Countries, species highest first, up to 1. | Yes |
| What have I seen in Thailand? | species recorded in Thailand | Species whose countries include Thailand, first seen newest first, up to 25. | Yes |
| Which orders haven't I seen anything from? | orders with none seen | Orders where seen is 0, seen highest first, up to 25. | Yes |
| Which families have I seen every species of? | families with all seen | Families where % seen is 100%, seen highest first, up to 25. | Yes |
| What endangered birds in Australasia haven't I seen yet? | not seen, Australasia, Endangered (or threatened) | Species that breed in Australasia that are threatened and that I haven't seen, first seen newest first, up to 25. | Yes |
| Show my lifers from March 2026 | seen, first seen in March 2026 | Error: Gemini error 503: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. | **No** |
| Which hummingbirds have I seen? | seen, family contains "hummingbird" | Species where family contains “Hummingbirds” and that I've seen, first seen newest first, up to 25. | Yes |
| What did I see at Hyde Park last weekend? | cannot (places below country, trips) | cannot: Specific birding locations like Hyde Park or individual dates are not tracked in these tables; try asking about a year, a month, or a country. | Yes |
| Which species have I seen in only one country? | cannot (needs two steps) | invalid: Can't use "eq" on countries. | **No** |
