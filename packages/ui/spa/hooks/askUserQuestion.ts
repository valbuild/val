import { z } from "zod";

// ask_user_question is the one tool whose arguments drive an interactive
// render rather than a lookup, so a malformed payload is not recoverable the
// way a bad argument to a read tool is: with no questions there is no card to
// submit, and since the tool intentionally sends no immediate result the turn
// would sit on a spinner forever.
//
// Only the fields the card cannot render without are strict. The cosmetic ones
// use .catch so a wrong type drops just that field rather than rejecting an
// otherwise perfectly answerable question.
export const AskUserQuestionArgs = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        header: z.string().optional().catch(undefined),
        options: z.array(
          z.object({
            label: z.string(),
            description: z.string().optional().catch(undefined),
          }),
        ),
        multiSelect: z.boolean().optional().catch(undefined),
        defaults: z.array(z.number()).optional().catch(undefined),
      }),
    )
    .min(1),
});

/** What the asker answered, as their Studio sends it back to the server. */
export const AskUserQuestionResult = z.object({
  answers: z.array(
    z.object({
      question: z.string(),
      selectedOptions: z.array(z.number()),
      customAnswer: z.string().nullable(),
    }),
  ),
});
