# Dog reference sampling and manual guides

Observed on 2026-11-14 from [Light a Paw memorials](https://lightapaw.com/memorials). The main workflow selected **Dogs**, inspected the initial cards, then pressed **Show more twice**: three displayed batches, 144 dog cards. The source list is `/tmp/photo-dog-cards.json`; hidden non-dog cards were excluded.

Sampling uses xorshift32 seeded with `20261114`, followed by a Fisher–Yates shuffle of the observed 144-card list. Indices below are **zero-based**. The first six candidates were 120, 13, 7, 127, 118, 99. Because three did not expose both eyes clearly, the next candidates 24, 140, 43, 63 were inspected. Five usable photographs remain; selection was based on landmark visibility, not a claim that these are representative breeds.

Files are temporary local test inputs only, under `/tmp/photo-dog-reference/`; they are not bundled into the public site or used to train a model. Names and source links identify the observed public cards. Breed labels are intentionally not inferred.

## Selected references

| Index | Name and observed source | Visible characteristics | Test file |
| --- | --- | --- | --- |
| 13 | [또또](https://lightapaw.com/%EB%98%90%EB%98%90) | White clipped coat, outward drooping ears, mildly tilted head | `dog-013.jpg` |
| 7 | [Zelda](https://lightapaw.com/zelda-4) | Dark short coat, upright broad ears, short broad muzzle, three-quarter face | `dog-007.jpg` |
| 127 | [Miss](https://lightapaw.com/miss) | Golden long coat, dark face mask, long drooping ears, short muzzle | `dog-127.jpg` |
| 140 | [Snoet](https://lightapaw.com/snoet) | Brown/white coat, long hanging ears, white blaze/muzzle, frontal open mouth | `dog-140.jpg` |
| 63 | [Yeontan](https://lightapaw.com/yeontan-5) | Black/tan coat, small upright ears, thick mane and fluffy silhouette | `dog-063.jpg` |

`guides.json` stores approximate, visually inspected left-eye, right-eye and nose coordinates normalized against the **entire image**, with left/right defined by image position. These are manual initial guides, not ground-truth annotations. The overlay should be checked before generating a model. All downloaded card images are small; muzzle depth and hidden body proportions cannot be inferred reliably from them.

## Rejected candidates

| Index | Name | Reason |
| --- | --- | --- |
| 120 | [Villa](https://lightapaw.com/villa) | Distant backlit dog looking upward; both eyes cannot be located reliably. |
| 118 | [Doggy](https://lightapaw.com/doggy-6) | Oblique face with nearly closed/partly hidden eyes. |
| 99 | [Kuinky](https://lightapaw.com/kuinky) | Dark shaggy coat obscures both eye centers. |
| 24 | [Leo](https://lightapaw.com/leo-31) | Distant side-facing head; too few facial pixels. |
| 43 | [Sky](https://lightapaw.com/sky-14) | Side-facing head and fur-obscured eyes. |

Exact observed image URLs, sampling order, rejection reasons and selected guides are retained in `/tmp/photo-dog-reference/selection.json`. No larger-image URLs were guessed or substituted.
