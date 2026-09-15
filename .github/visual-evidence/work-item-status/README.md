# Work item status visual evidence

These captures use Ask Dev commit `2114612cc1a8d5fac74aa5b7568f5e65f41e3dd7`
(tree `98a094315756c34d031ffbc4659dd68f40aa4743`). They show the real local
page with intercepted producer results; they do not represent live or deployed data.

The ordinary input is the unchanged actual producer floor result
SHA256 `8fc3bf17707c101c721de497befe203441587f2d718cf4b6d96de40fd8730528`.
The stress input is the unchanged repeated-title producer result
SHA256 `0464891789a9281d9e9105a98c4c2f700b1803e1c314bf7c10162f42157d70a4`.
The blank-value image uses a separately labeled controlled variant.

| Image | Caption | Dimensions | Bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `ordinary-short-label-1440.png` | Ordinary short-label actual producer result at desktop width. | 1440 × 844 | 78,028 | `a52cda94a3bf9114b5a0e7920ef708a386bbcd19faf70fa6b9da6bd4d824b204` |
| `ordinary-short-label-390.png` | Ordinary short-label actual producer result at narrow width. | 390 × 844 | 64,031 | `24c021f778bcf46b30481dacf2853832a39f4a9a2ebee5618b3e59009d6522e6` |
| `stress-490-character-label-390.png` | Deliberate repeated 490-character title stress fixture. | 390 × 844 | 67,310 | `7ab6af4d02f263fb7bbc86ecacffa86d114d7241c382c449018a764c5648e8d6` |
| `stress-blank-value-390.png` | Controlled blank-value case on the retained stress fixture. | 390 × 844 | 69,690 | `e42b4f22f24d18176a975c202edb46f77bff4ae2c9c552bd7e8bf1f4a41045a0` |

Ordinary images are the primary display examples. Stress images are separate regression evidence; their title length and row count are not design requirements.
