"""TCMPL onboarding voice agent (LiveKit Agents + Sarvam + Azure OpenAI).

The onboarding app dispatches this agent with the call details as job metadata. The agent dials the
candidate through the Plivo trunk, holds a short conversation, and posts the outcome, the answers it
collected and the transcript back to the app (CALL_RESULT_URL, protected by CALL_AGENT_SECRET).

Secrets / settings (LiveKit Cloud agent secrets, or .env.local when running locally):
  SIP_OUTBOUND_TRUNK_ID      ST_... (LiveKit outbound trunk to Plivo)
  SARVAM_API_KEY             Sarvam speech recognition and voice
  AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
  CALL_RESULT_URL            https://<app>/api/calls/result
  CALL_AGENT_SECRET          shared secret, the same value as in the app's Azure settings
  AGENT_NAME                 optional, default tcmpl-onboarding-caller
  VOICE_SPEAKER              optional Sarvam bulbul:v3 speaker, default priya
  VOICE_LLM_DEPLOYMENT       optional: a faster Azure deployment just for calls (default AZURE_OPENAI_DEPLOYMENT)
  VOICE_LLM_MODEL            optional: the model behind it, e.g. gpt-4.1-mini or gpt-5-mini (reasoning models are
                             then asked to think minimally, which removes seconds of delay)
"""

import asyncio
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import aiohttp
from dotenv import load_dotenv
from google.protobuf.duration_pb2 import Duration
from livekit import api
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    function_tool,
    get_job_context,
    room_io,
)
from livekit.plugins import openai, sarvam, silero

import scripts

load_dotenv(".env.local")
logger = logging.getLogger("tcmpl-voice")

AGENT_NAME = os.getenv("AGENT_NAME", "tcmpl-onboarding-caller")
LANGS = {"en-IN", "hi-IN", "mr-IN", "gu-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "bn-IN", "pa-IN", "or-IN"}


def azure_endpoint() -> str:
    """Like the app (api/src/lib/ai.js): only https://<host> is used, any path after it is ignored."""
    raw = os.environ["AZURE_OPENAI_ENDPOINT"].strip()
    u = urlparse(raw)
    return f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else raw.rstrip("/")


REASONING_NAMES = {"gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5"}


def llm_options() -> dict:
    """Azure OpenAI settings for calls. "Thinking" models (GPT-5, o-series) are told to think as little as
    possible: on a phone call every second of thinking is a second of silence."""
    deployment = os.getenv("VOICE_LLM_DEPLOYMENT", "").strip() or os.environ["AZURE_OPENAI_DEPLOYMENT"].strip()
    name = (os.getenv("VOICE_LLM_MODEL", "").strip() or deployment).lower()
    opts = dict(
        azure_endpoint=azure_endpoint(),
        azure_deployment=deployment,
        api_key=os.environ["AZURE_OPENAI_API_KEY"].strip(),
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "").strip() or "2024-10-21",
    )
    if "chat" in name:
        pass  # "-chat" models don't think and don't accept the setting
    elif name in REASONING_NAMES:
        opts["model"] = name  # the plugin then picks the lowest reasoning effort for that model
    elif re.match(r"^gpt-5\.\d", name):
        opts["reasoning_effort"] = "none"
    elif name.startswith("gpt-5"):
        opts["reasoning_effort"] = "minimal"
    elif re.match(r"^o\d", name):
        opts["reasoning_effort"] = "low"
    return opts


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Short sounds while the answer is being prepared, so the line is never silent.
FILLERS = {
    "en-IN": ["Okay…", "Sure…", "Alright…", "Got it…", "Right…"],
    "hi-IN": ["जी…", "अच्छा…", "ठीक है…", "Okay जी…", "हाँ जी…"],
}
FILLER_AFTER = 0.45  # seconds after the candidate's turn ends before a filler is said (skipped if the reply is ready)


class CallState:
    """Everything the app gets back at the end of the call."""

    def __init__(self, meta: dict):
        self.meta = meta
        self.status = "dialing"          # dialing → answered | no_answer | busy | declined | failed
        self.sip_status = ""
        self.started = time.time()
        self.answered_at: float | None = None
        self.answers: dict[str, str] = {}
        self.flags: list[str] = []
        self.callback = ""
        self.language = meta.get("language") if meta.get("language") in LANGS else "en-IN"
        self.last_filler = ""
        self.posted = False


class OnboardingCaller(Agent):
    def __init__(self, state: CallState, tts: sarvam.TTS):
        super().__init__(instructions=scripts.instructions(state.meta))
        self.state = state
        self._tts = tts

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        """The candidate finished speaking: if the reply takes a moment, say a short filler ("Okay…")."""
        asyncio.create_task(self._filler())

    async def _filler(self) -> None:
        await asyncio.sleep(FILLER_AFTER)
        session = self.session
        if session.agent_state != "thinking":
            return  # the reply is already playing
        words = FILLERS.get(self.state.language, FILLERS["en-IN"])
        choice = random.choice([w for w in words if w != self.state.last_filler] or words)
        self.state.last_filler = choice
        session.say(choice, add_to_chat_ctx=False, allow_interruptions=True)

    @function_tool()
    async def switch_language(self, context: RunContext, language: str) -> str:
        """Change the voice language when the candidate prefers another language.

        Args:
            language: en-IN for English, hi-IN for Hindi (also mr-IN, gu-IN, ta-IN, te-IN, kn-IN, ml-IN, bn-IN, pa-IN)
        """
        if language not in LANGS:
            return "unsupported language, continue in the current one"
        self.state.language = language
        self._tts.update_options(target_language_code=language)
        return f"voice switched to {language}"

    @function_tool()
    async def end_call(self, context: RunContext) -> str:
        """End the call after you have said goodbye."""
        await context.wait_for_playout()
        ctx = get_job_context()
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        return "call ended"


async def post_result(state: CallState, session: AgentSession | None) -> None:
    """Send the outcome to the app once (on hang-up, failure or shutdown)."""
    if state.posted:
        return
    state.posted = True
    url, secret = os.getenv("CALL_RESULT_URL", ""), os.getenv("CALL_AGENT_SECRET", "")
    transcript = []
    if session is not None:
        try:
            for item in session.history.items:
                if getattr(item, "type", "") == "message" and item.role in ("user", "assistant"):
                    text = (item.text_content or "").strip()
                    if text:
                        transcript.append({"role": "candidate" if item.role == "user" else "agent", "text": text[:1000]})
        except Exception as e:  # never lose the result because of the transcript
            logger.warning("transcript failed: %s", e)
    end = time.time()
    body = {
        "callId": state.meta.get("callId", ""),
        "candidateId": state.meta.get("candidateId", ""),
        "purpose": state.meta.get("purpose", "general"),
        "status": state.status,
        "sipStatus": state.sip_status,
        "startedAt": datetime.fromtimestamp(state.started, timezone.utc).isoformat(),
        "answeredAt": datetime.fromtimestamp(state.answered_at, timezone.utc).isoformat() if state.answered_at else None,
        "endedAt": now_iso(),
        "durationSec": int(end - state.answered_at) if state.answered_at else 0,
        "language": state.language,
        "answers": state.answers,
        "flags": state.flags,
        "callback": state.callback,
        "transcript": transcript[-200:],
    }
    if not url or not secret:
        logger.warning("CALL_RESULT_URL / CALL_AGENT_SECRET not set; result only logged: %s", json.dumps(body)[:2000])
        return
    for attempt in range(3):
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(url, json=body, headers={"x-call-key": secret}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status < 300:
                        return
                    logger.warning("result post returned %s", r.status)
        except Exception as e:
            logger.warning("result post failed: %s", e)
        await asyncio.sleep(2 * (attempt + 1))


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(min_silence_duration=0.3)


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session(agent_name=AGENT_NAME)
async def outbound_call(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata or "{}")
    state = CallState(meta)
    phone = str(meta.get("phone") or "").strip()
    trunk = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
    session: AgentSession | None = None

    async def on_shutdown(*_):
        await post_result(state, session)

    ctx.add_shutdown_callback(on_shutdown)

    if not phone.startswith("+") or not trunk.startswith("ST_"):
        state.status, state.sip_status = "failed", "missing phone number or SIP_OUTBOUND_TRUNK_ID"
        ctx.shutdown()
        return

    await ctx.connect()

    tts = sarvam.TTS(target_language_code=state.language, model="bulbul:v3",
                     speaker=meta.get("voice") or os.getenv("VOICE_SPEAKER", "priya"), pace=1.05,
                     min_buffer_size=30)
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=sarvam.STTRealtime(language="auto" if meta.get("language") in (None, "", "auto") else state.language,
                               mode="codemix", stream_type="fast"),
        llm=openai.LLM.with_azure(**llm_options()),
        tts=tts,
        turn_handling={
            "endpointing": {"min_delay": 0.3, "max_delay": 1.5},
            "preemptive_generation": {"enabled": True, "preemptive_tts": True},
        },
    )
    agent = OnboardingCaller(state, tts)

    # Start the session first so nothing the candidate says after answering is missed.
    session_started = asyncio.create_task(session.start(
        agent=agent, room=ctx.room,
        room_options=room_io.RoomOptions(participant_identity="candidate", close_on_disconnect=True, delete_room_on_close=True),
    ))

    try:
        await ctx.api.sip.create_sip_participant(api.CreateSIPParticipantRequest(
            room_name=ctx.room.name,
            sip_trunk_id=trunk,
            sip_call_to=phone,
            participant_identity="candidate",
            participant_name=meta.get("name") or "Candidate",
            wait_until_answered=True,
            ringing_timeout=Duration(seconds=40),
            max_call_duration=Duration(seconds=int(meta.get("maxSeconds") or 600)),
            krisp_enabled=True,
        ))
    except api.TwirpError as e:
        code = str((e.metadata or {}).get("sip_status_code", ""))
        state.sip_status = f"{code} {(e.metadata or {}).get('sip_status', '')}".strip()
        state.status = {"486": "busy", "600": "busy", "603": "declined", "480": "no_answer", "408": "no_answer", "487": "no_answer"}.get(code, "failed")
        logger.info("call not connected: %s", state.sip_status)
        session_started.cancel()
        ctx.shutdown()
        return

    state.status, state.answered_at = "answered", time.time()
    await session_started
    # The first line is fixed (no AI wait): short, says who is calling, asks for two minutes.
    session.say(scripts.greeting(meta, state.language))


if __name__ == "__main__":
    cli.run_app(server)
