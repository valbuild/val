# Code mode: how many replies a change takes

A code-mode change is slow mostly in proportion to the number of model
replies it takes. Each reply that calls a tool is a round trip: model, content
service, websocket, the Studio tab, the tool, and back. This note has the
tasks we count replies on, what a perfect run of each touches, and how many
replies it needs. Run the tasks again after changing the prompt
(`hooks/assistantSystemPrompt.ts`), the map (`proposals/projectMap.ts`) or a
tool's answer.

## These numbers are reasoned, not measured

No model was run for them. The mock content host plays scripted turns
(`e2e/mock-content-host`), and the environment this was written in had no
model key. "Before" is a model that follows the old prompt's rules, with one
independent call per reply, which is what the old prompt asked for ("Always
call get_all_schema first", "Find before you read", "call this after every
change"). "After" is the fewest replies the new prompt allows. A real model
lands between the two, so measure before quoting either.

## The tasks

Project: `tanstack/full` from valbuild/templates, in a proposal with code mode
on. A reply is one model response; the last one is the closing message.

"Find and edit" is what the map and the code-mode rules change. "Checks" is
`format_files`, `lint` and `typecheck`, one reply each as the prompt asks for
them today, and `build_proposal` where a quick preview cannot show the change.

| #   | Message                                               | Files a perfect run touches                                                                                                                                                                        | Find and edit, before | Find and edit, after | Checks | Total before | Total after |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------- | ------ | ------------ | ----------- |
| 1   | Make the hero heading larger                          | reads `HeroSection.tsx`, `base/SectionHeader.tsx`, `typography/Heading.tsx`; edits `HeroSection.tsx`                                                                                               | 7                     | 2                    | 3      | 11           | 6           |
| 1p  | The same, with the heading picked: "make this larger" | the same                                                                                                                                                                                           | 6                     | 2                    | 3      | 10           | 6           |
| 2   | Change the footer's background                        | reads and edits `src/components/Footer.tsx`                                                                                                                                                        | 5                     | 2                    | 3      | 9            | 6           |
| 2p  | The same, with the footer picked: "darker background" | the same                                                                                                                                                                                           | 4                     | 2                    | 3      | 8            | 6           |
| 3   | Add a subtitle field to the hero                      | reads `heroSection.val.ts`, `HeroSection.tsx`, `routes/_site.index.val.ts`; edits all three                                                                                                        | 9                     | 2                    | 4      | 14           | 7           |
| 4   | Add a testimonials section                            | reads `AnySection.tsx`, `anySection.val.ts` and one section pair as the example; writes `testimonialsSection.val.ts` and `TestimonialsSection.tsx`; edits `anySection.val.ts` and `AnySection.tsx` | 11                    | 2                    | 4      | 16           | 7           |

How the "before" column is counted, for task 1: `get_all_schema`,
`search_code` for the hero, `read_file` of the section, of the header it
renders, of the heading that renders, `edit_file`, `validate_content`. Seven,
then the three checks and the closing message. `set_session_name` is not
counted in either column: it was often a reply of its own.

"After" is two for every task because the map names the files (routes, each
`.val.ts` and what imports it, the files by directory), so the first reply
reads all of them, and the second sends every edit.

## How to measure

1. Create a project from `tanstack/full`, open a proposal, turn on code mode.
2. For each task: a new chat, send the message exactly as written. For the
   `p` tasks, pick the element in the preview first.
3. Count the model's replies in the turn: the number of responses that carry
   tool calls, plus the closing one. The turn trace counts them where it has
   landed; otherwise count the groups of tool activity in the chat.
4. Write down, per reply, which tools it called. A reply with one `read_file`
   in it, followed by a reply with another, is the thing to look for.
5. Run each task three times per model, on an Anthropic model and an OpenAI
   one: the prompt is shared.

Reset the proposal between tasks, so a later one does not find the earlier
one's files.

## What still costs a reply

- **A chain of imports.** The map says who imports a `.val.ts`; it does not
  say that `HeroSection.tsx` renders `SectionHeader.tsx`, which renders
  `Heading.tsx`. A model that reads one, then the next, spends three replies
  on task 1. `read_file` could answer with the project files the file
  imports, so the second reply reads the rest.
- **The checks.** `format_files`, then `lint`, then `typecheck` are three
  replies after every change.
- **`typecheck`'s answer** ends with "Call build_proposal when the change is
  complete", which asks for a build that a component or style change does
  not need.
- **The first message after code mode comes on** can be sent before the
  project has been read, and then has no map.
