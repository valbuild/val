---
"@valbuild/ui": patch
---

Harden `ask_user_question` argument handling so a recoverable problem does not cost the whole clarification card:

- A wrong type on a cosmetic field (`header`, `description`, `multiSelect`, `defaults`) now drops just that field instead of rejecting the call. Only the fields the card cannot render without — the questions themselves and their option labels — are still strict.
- Validation failures report via `z.prettifyError` rather than the raw issue JSON, so the model gets a one-line reason instead of a dozen lines of noise in its context.
- The call is rejected up front when there is no chat UI mounted to render the card. Previously it was recorded as pending with nothing to show and no result ever sent, which — since the tool sets `timeoutMs: null` — left the server waiting forever.
