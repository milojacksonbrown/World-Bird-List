# Design: Name Fixes assistant

Status: agreed 10 Nov 2026, build starting 11–12 Nov 2026

## Problem

When an eBird name can't be matched to an AviList species, the script lists it on the **Name Fixes** tab. At the moment I have to look up the correct AviList scientific name myself and type it into column C. This is slow, and it's easy to make typos.

## Goal

For each unmatched name, suggest the most likely AviList species, say how confident the suggestion is and why, and let me accept it with one tick. Nothing is applied without my approval.

## How a suggestion is made

1. **String matching (no AI).** Compare the unmatched eBird name with every AviList scientific and common name, ignoring case, accents, hyphens and common spelling variants (e.g. Grey/Gray). This catches typos and small spelling differences for free.
1b. **AviList subspecies (added 12 Nov 2026, no AI).** If AviList lists the eBird name as a subspecies of exactly one species in the same genus (eBird *Corvus cornix* = AviList *Corvus corone cornix*), suggest that species with High confidence. Found by testing: this solved every unmatched name in my data, while a smaller AI model got them wrong. Website only for now: the spreadsheet's Species tab doesn't store subspecies names yet.
2. **Shortlist.** For each unmatched name, the script builds a shortlist of about 10 AviList candidates: the most similar-looking names, plus the other species in the same genus.
3. **AI check (Gemini API, free tier, Flash model).** The AI is sent the unmatched name and the shortlist only. It must pick one candidate from the shortlist or answer "none", and give a one-line reason. Any answer that isn't on the shortlist is rejected.

## Confidence

Confidence comes from whether the two methods agree, not from the AI's own estimate of how sure it is (AI models are poor judges of their own certainty).

| Confidence | When |
|---|---|
| High | String matching finds a near-identical name (only spelling or punctuation differs), or string matching and the AI pick the same species |
| Medium | Only one of the two methods finds a match, with a sensible reason |
| Low | The two methods disagree, or the AI is unsure. Shown with the reason it is doubtful |
| Blank | The AI answers "none". I fix it by hand |

## What I see in the Name Fixes tab

Existing columns stay as they are. New columns:

| Column | Contents |
|---|---|
| Suggested species | AviList scientific name |
| Confidence | High / Medium / Low |
| Reason | One line: how the match was found or why it is doubtful |
| Accept | Tick box |

- **Ticking Accept** copies the suggestion into column C (the fix) straight away.
- **Unticking Accept** clears column C again, so the tick box always reflects what is applied.
- The fix is used the next time eBird data is processed, as before.

## Data and privacy

- Only bird names are sent to the AI: the unmatched eBird name and the shortlist of AviList names.
- No dates, locations, counts, checklist IDs or personal details are sent.
- Free-tier Gemini usage may be used by Google to improve its products, which is another reason to send names only.
- The API key is stored in Apps Script **Script Properties**, never in the code (`LifeList.gs` or `NameFixesAssistant.gs`), so it is never committed to GitHub.

## Known limitations

- If a species has been renamed to something completely different, the correct answer may not be on the shortlist. Testing will show whether this happens in practice.
- String matching can be confidently wrong when names look alike but are different birds (e.g. Lesser vs Greater Whitethroat). This is why every suggestion still needs my approval.
- The free tier has request limits. This is fine for a handful of unmatched names per import, but would not suit a large first import.

## How it will be tested

- About 20 eBird names where I already know the correct AviList species.
- Record for each: what string matching suggested, what the AI suggested, the confidence given, and whether it was right.
- Report how many each method solved alone, how many needed both, and any wrong suggestions marked High.
- Unit tests for the string-matching and shortlist functions, run outside Google.
