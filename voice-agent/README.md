# TCMPL onboarding voice agent

LiveKit Agents (Python) + Sarvam (speech recognition and Indian voices) + Azure OpenAI.
The onboarding app starts each call (`/api/calls/start` → LiveKit room + agent dispatch); this agent dials the
candidate through the Plivo trunk, talks, and posts the outcome to `/api/calls/result`.

## Deploy (Windows PowerShell, from this folder)

1. Copy `.env.example` to `secrets.env` and fill in the values (never commit `secrets.env`).
2. First deploy, in LiveKit's Mumbai region:

   ```
   lk agent create --region ap-south --secrets-file secrets.env
   ```

3. Later changes: `lk agent deploy`. Logs: `lk agent logs`. Status: `lk agent status`.

## Call purposes

`confirm` offer confirmation · `noreply` no reply on WhatsApp · `eve` day before joining · `close` 90-day closing ·
`general` HR's own note. Scripts are in `scripts.py`.

## Local test (optional)

```
python -m venv .venv; .venv\Scripts\activate; pip install -r requirements.txt
python agent.py dev
```
Then start a call from the app (the agent name must match `LIVEKIT_AGENT_NAME`, default `tcmpl-onboarding-caller`).
