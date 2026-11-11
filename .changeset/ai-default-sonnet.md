---
"@valbuild/ui": patch
---

The assistant now starts on the newest Claude Sonnet the project's Anthropic key can reach, or, with only an OpenAI key, the newest GPT of OpenAI's balanced tier (Sol, such as `gpt-6.1-sol`, or the newest plain `gpt-N.M` where there is no Sol). It is chosen from the models the provider reports, so a newly released Sonnet or GPT becomes the default without a Val update. A model an editor has picked themselves is still remembered and still wins.
