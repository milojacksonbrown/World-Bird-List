# eBird names against AviList: coverage check

Run on 2026-11-12 with `node tools/check-ebird-coverage.js`: every **species** in eBird's taxonomy
(11,201 names) through the website's matching, with no AI. AviList v2026.

| How the name is settled | Names | Share |
|---|---|---|
| Matches an AviList species directly | 11168 | 99.7% |
| Identical once tidied (High suggestion) | 0 | 0.0% |
| AviList lists it as a subspecies (High suggestion) | 21 | 0.2% |
| **Settled without AI** | **11189** | **99.9%** |
| Left for the AI: string matching has a guess | 2 | 0.0% |
| Left for the AI: no guess at all | 10 | 0.1% |

Of the direct matches, 10 matched by common name rather than scientific name, and 0 have a different eBird species code in AviList (same name, but the two checklists may draw the species differently).


**Below species level** (subspecies groups, forms, intergrades: 4,748 names): 4646 counted towards an AviList species directly, 6 via the subspecies rule, 4 not matched, 92 skipped.

## Settled by the subspecies rule (21)

| eBird name | AviList species |
|---|---|
| Andean Duck (*Oxyura ferruginea*) | *Oxyura jamaicensis* |
| Salim Ali's Swift (*Apus salimalii*) | *Apus pacificus* |
| Blyth's Swift (*Apus leuconyx*) | *Apus pacificus* |
| Cook's Swift (*Apus cooki*) | *Apus pacificus* |
| Peruvian Racket-tail (*Ocreatus peruanus*) | *Ocreatus underwoodii* |
| Rufous-booted Racket-tail (*Ocreatus addae*) | *Ocreatus underwoodii* |
| Black-backed Swamphen (*Porphyrio indicus*) | *Porphyrio porphyrio* |
| African Swamphen (*Porphyrio madagascariensis*) | *Porphyrio porphyrio* |
| Australasian Swamphen (*Porphyrio melanotus*) | *Porphyrio porphyrio* |
| Philippine Swamphen (*Porphyrio pulverulentus*) | *Porphyrio porphyrio* |
| Gray-headed Swamphen (*Porphyrio poliocephalus*) | *Porphyrio porphyrio* |
| Vanuatu Petrel (*Pterodroma occulta*) | *Pterodroma cervicalis* |
| Balearic Shearwater (*Puffinus mauretanicus*) | *Puffinus yelkouan* |
| Hooded Crow (*Corvus cornix*) | *Corvus corone* |
| Anjouan White-eye (*Zosterops anjuanensis*) | *Zosterops maderaspatanus* |
| Moheli White-eye (*Zosterops comorensis*) | *Zosterops maderaspatanus* |
| Aldabra White-eye (*Zosterops aldabrensis*) | *Zosterops maderaspatanus* |
| Rio Negro Gnatcatcher (*Polioptila facilis*) | *Polioptila paraensis* |
| Inambari Gnatcatcher (*Polioptila attenboroughi*) | *Polioptila paraensis* |
| Malabar Starling (*Sturnia blythii*) | *Sturnia malabarica* |
| Amur Stonechat (*Saxicola stejnegeri*) | *Saxicola maurus* |

## Left for the AI or a person (12)

| eBird name | String matching |
|---|---|
| Finsch's Duck (*Chenonetta finschi*) | no guess |
| Mauritius Wood-Pigeon (*Columba thiriouxi*) | no guess |
| Mauritius Turtle-Dove (*Nesoenas cicur*) | no guess |
| Rodrigues Blue-Pigeon (*Alectroenas payandeei*) | string guess: Nesoenas rodericanus (80%) |
| Hodgen's Waterhen (*Tribonyx hodgenorum*) | no guess |
| New Caledonian Swamphen (*Porphyrio kukwiedei*) | no guess |
| Reunion Swamphen (*Porphyrio caerulescens*) | no guess |
| Martinique Amazon (*Amazona martinicana*) | no guess |
| Guadeloupe Amazon (*Amazona violacea*) | string guess: Amazona vinacea (87%) |
| Guadeloupe Parakeet (*Psittacara labati*) | no guess |
| Raiatea Starling (*Aplonis ulietensis*) | no guess |
| Reunion Fody (*Foudia delloni*) | no guess |

## Below species level, not matched (4)

| eBird name | Category |
|---|---|
| Maranhao Hermit (unrecognized species) (*Phaethornis maranhaoensis [unrecognized species]*) | form |
| Elegant Emerald (unrecognized species) (*Riccordia elegans [unrecognized species]*) | form |
| Guanacaste Hummingbird (unrecognized species) (*Saucerottia alfaroana [unrecognized species]*) | form |
| Andean Storm-Petrel (unrecognized species) (*Oceanites barrosi [unrecognized species]*) | form |

## Same name, different eBird code (0)

| eBird name | AviList species |
|---|---|
