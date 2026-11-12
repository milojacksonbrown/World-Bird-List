# Name Fixes: live check

Run on 2026-11-12 with `node tools/check-name-fixes.js`, on the unmatched names in docs/data/sample-ebird.csv.
The last column is for a person to fill in.

| eBird name | Suggested AviList species | Confidence | Reason | Answered by | Right? |
|---|---|---|---|---|---|
| Australasian Swamphen (Porphyrio melanotus) | Purple Swamphen (Porphyrio porphyrio) | Medium | AI only: AviList treats the Australasian Swamphen as a subspecies or group within the broader Purple Swamphen (Porphyrio porphyrio) species complex. | gemini-3-flash-preview |  |
| Hooded Crow (Corvus cornix) | Carrion Crow (Corvus corone) | Low | Methods disagree: AI picked this (Corvus cornix (Hooded Crow) is often taxonomically-related or closely related to Corvus corone (Carrion Crow) and they are areally-related species/subspecies/ls-ls-ls-ls-ls-ls-}); string matching picked Corvus corax via scientific name | gemma-4-26b-a4b-it (backup) |  |
