---
"@valbuild/ui": patch
---

Compare: adding a clause after a word no longer strikes out the word. The highlighted difference between two texts treated `code` and `code,` as different words, so "…with your code" against "…with the code, and stays editable" showed "code" as replaced. Punctuation that ends a word is now compared on its own.
