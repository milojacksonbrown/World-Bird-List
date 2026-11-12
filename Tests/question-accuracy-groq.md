# Ask your list: accuracy check (Groq, GPT-OSS 120B)

Run on 2026-11-12 against Lyrebird version 2026-11-12 (session 4e) (16 of 16 understood as expected).
Model: `openai/gpt-oss-120b` on Groq (Lyrebird's AI_MODELS set to `groq:openai/gpt-oss-120b` only).
Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.

| Question | Counts as right | Understood as | Answered by | Right? |
|---|---|---|---|---|
| Which families have I seen less than 10% of? | families, % seen under 10 | Families where % seen is under 10%, % seen lowest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| How many lifers did I get in 2024? | lifers first seen in 2024 (species or years table) | Years where year is 2024, year lowest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Which threatened species have I seen? | seen and threatened | Species that are threatened and that I've seen, first seen newest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| What were my first 10 lifers in Asia? | seen, Asia, oldest first, 10 | Species found in Asia that I've seen, first seen oldest first, up to 10. | groq:openai/gpt-oss-120b | Yes |
| Which year did I get the most lifers? | years by lifers, highest first | Years, lifers highest first, up to 1. | groq:openai/gpt-oss-120b | Yes |
| Which month do I see the most species in? | months by species, highest first | Months, species highest first, up to 1. | groq:openai/gpt-oss-120b | Yes |
| Which owls have I seen? | seen, family contains "owl" | Species where family contains “owls” and that I've seen, species A to Z, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Which country have I seen the most species in? | countries by species, highest first | Countries, species highest first, up to 1. | groq:openai/gpt-oss-120b | Yes |
| What have I seen in Thailand? | species recorded in Thailand | Species that I've seen and whose countries include Thailand, first seen newest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Which orders haven't I seen anything from? | orders with none seen | Orders where seen is 0, order A to Z, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Which families have I seen every species of? | families with all seen | Families where % seen is 100%, family A to Z, up to 25. | groq:openai/gpt-oss-120b | Yes |
| What endangered birds in Australasia haven't I seen yet? | not seen, Australasia, Endangered (or threatened) | Species found in Australasia where iucn is “EN” and that I haven't seen, first seen newest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Show my lifers from March 2026 | seen, first seen in March 2026 | Species that I've seen and year first seen is 2026 and month first seen is 3, first seen oldest first, up to 25. | groq:openai/gpt-oss-120b | Yes |
| Which hummingbirds have I seen? | seen, family contains "hummingbird" | Species that I've seen and family contains “hummingbird”, species A to Z, up to 25. | groq:openai/gpt-oss-120b | Yes |
| What did I see at Hyde Park last weekend? | cannot (places below country, trips) | cannot: The question asks about a specific location and time not represented in the tables. | groq:openai/gpt-oss-120b | Yes |
| Which species have I seen in only one country? | cannot (needs two steps) | cannot: Cannot filter by number of countries in list with available operators | groq:openai/gpt-oss-120b | Yes |
