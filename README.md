# AI Roundtable

A small experimental roundtable for one human and multiple AI participants.

## Core idea

- Participants appear to one another only as anonymous IDs such as Participant A/B/C/D.
- The internal log may record the real provider/model and whether the participant is human or AI.
- AI participants must request the floor before speaking.
- The human can pause the meeting at any time to think and speak.
- Agreement and a single correct answer are **not** required.
- Each AI has a finite speaking budget so choosing when to speak is part of the experiment.
- Listening/decision cost and actual speaking cost should be tracked separately.
- API secrets must never be committed to this repository.

## Initial participants

- Human
- OpenAI model
- Anthropic Claude
- Google Gemini

## Security

Put real API keys only in a local `.env` file or another secret store.
Never commit `.env` or raw API keys.

See `.env.example` for variable names only.
