---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

The assistant's default model is now chosen by Val Build, not built into the Studio, so it can change for every project without a Val upgrade. It starts on the newest Claude Sonnet the project's Anthropic key can reach, or, with only an OpenAI key, the newest GPT of OpenAI's balanced tier (such as `gpt-6.1-sol`). A model an editor has picked themselves is still remembered and still wins. The built-in fallback catalog, used only when the models cannot be listed, now offers the Claude 5.5 models.
