# Ask your list: accuracy check

Run on 2026-11-11 against Lyrebird version 2026-11-11 (session 4b) (4 of 16 understood as expected).
Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.

| Question | Counts as right | Understood as | Right? |
|---|---|---|---|
| Which families have I seen less than 10% of? | families, % seen under 10 | Error: free-tier limit reached, try again later | **No** |
| How many lifers did I get in 2024? | lifers first seen in 2024 (species or years table) | Error: free-tier limit reached, try again later | **No** |
| Which threatened species have I seen? | seen and threatened | Species that are threatened and that I've seen, first seen newest first, up to 25. | Yes |
| What were my first 10 lifers in Asia? | seen, Asia, oldest first, 10 | Error: free-tier limit reached, try again later | **No** |
| Which year did I get the most lifers? | years by lifers, highest first | Years, lifers highest first, up to 1. | Yes |
| Which month do I see the most species in? | months by species, highest first | Error: free-tier limit reached, try again later | **No** |
| Which owls have I seen? | seen, family contains "owl" | Error: free-tier limit reached, try again later | **No** |
| Which country have I seen the most species in? | countries by species, highest first | Error: free-tier limit reached, try again later | **No** |
| What have I seen in Thailand? | species recorded in Thailand | Error: free-tier limit reached, try again later | **No** |
| Which orders haven't I seen anything from? | orders with none seen | Orders where seen is 0, seen highest first, up to 25. | Yes |
| Which families have I seen every species of? | families with all seen | Error: free-tier limit reached, try again later | **No** |
| What endangered birds in Australasia haven't I seen yet? | not seen, Australasia, Endangered (or threatened) | Species that breed in Australasia where iucn is “EN” and that I haven't seen, first seen newest first, up to 25. | Yes |
| Show my lifers from March 2026 | seen, first seen in March 2026 | Error: free-tier limit reached, try again later | **No** |
| Which hummingbirds have I seen? | seen, family contains "hummingbird" | Error: free-tier limit reached, try again later | **No** |
| What did I see at Hyde Park last weekend? | cannot (places below country, trips) | Error: free-tier limit reached, try again later | **No** |
| Which species have I seen in only one country? | cannot (needs two steps) | invalid: Can't use "eq" on countries. | **No** |
