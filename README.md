# AI Roundtable

One human and multiple AI systems share an anonymous roundtable.

## Current participants

- Participant A — OpenAI model
- Participant B — human operator
- Participant C — Gemini
- Participant D — Claude

The mapping above is observer metadata. It is **not** included in the transcript given to participants.

## Meeting rules

- Participants see only anonymous IDs such as Participant A/B/C/D.
- No participant is told which participant is human or which provider/model another participant uses.
- AI participants do not speak in a fixed order.
- After each public statement, each active AI separately decides whether to **raise its hand** or **pass**.
- Only an AI that raises its hand can be selected to speak.
- If several AIs raise their hands, the program uses rotating fairness rather than a semantic judge.
- After an AI speaks, all active AIs reconsider the new conversation state.
- The human can request the floor at any time. No new AI turn begins after the current API operation finishes.
- Agreement, consensus, and a single correct answer are not required.
- A safety cap stops the meeting after 10 consecutive AI speeches and returns the floor to the human.

## Finite participation budget

Each AI currently starts a session with **12,000 virtual token-units**.

Both of these consume that budget:

1. listening / deciding whether to speak;
2. actual speech generation.

This makes silence non-free: an AI that repeatedly listens and passes still spends resources.

The current budget is an **experimental meeting budget**, not the provider's real ChatGPT/Claude/Gemini subscription quota. API billing and provider-side limits remain separate. A later version can convert provider usage/cost/rate-limit information into different per-participant budgets.

## Observer log

The browser keeps a private observer log for the local session with:

- hand raise / pass;
- self-reported urgency;
- intended target participant;
- private short reason;
- token-units spent deciding;
- token-units spent speaking.

This metadata is not added to the public roundtable transcript.

## Security

Real API keys belong only in local environment variables or another secret store:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`

Never commit raw API keys or a real `.env` file.
