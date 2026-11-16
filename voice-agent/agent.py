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
import numpy as np
from dotenv import load_dotenv
from google.protobuf.duration_pb2 import Duration
from livekit import api, rtc
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
    utils,
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


# Short sounds said only after the candidate has finished speaking, and only while the answer is still being
# prepared. They are pre-recorded at the start of the call and played as the first part of the reply itself,
# so a filler can never come after the agent has spoken. The kind of filler follows what the candidate said.
FILLERS = {
    "en-IN": {
        "question": ["Sure…", "Good question…", "Let me tell you…"],
        "yes": ["Great…", "Okay…", "Alright…"],
        "problem": ["I understand…", "Okay, got it…"],
        "other": ["Okay…", "Got it…", "Right…", "Alright…"],
    },
    "hi-IN": {
        "question": ["जी, बताती हूँ…", "Sure…"],
        "yes": ["बढ़िया…", "Okay जी…", "ठीक है…"],
        "problem": ["समझ गई…", "अच्छा, ठीक है…"],
        "other": ["अच्छा…", "ठीक है…", "हाँ जी…", "Okay…"],
    },
}
FILLER_AFTER = 0.5   # seconds of silence after the candidate stops before a filler is played
SHORT_AFTER = 1.0    # after a one-word answer ("yes", "haan") wait a little longer: that reply is usually quick

_Q = re.compile(r"\?|^(what|when|where|why|how|which|who|can|could|will|is|are|do|does|kya|kab|kaise|kahan|kitna|kitne|kaun|kyun)\b", re.I)
_YES = re.compile(r"^(yes|yeah|yep|ok|okay|sure|done|haan|ha|han|ji|hmm|right|correct|theek|thik|bilkul)\b", re.I)
_PROBLEM = re.compile(r"\b(no|not|nahi|nahin|can't|cannot|won't|problem|issue|delay|late|sorry|mushkil|dikkat)\b", re.I)


_Q_HI = ("क्या", "कब", "कैसे", "कहाँ", "कहां", "कितना", "कितने", "कौन", "क्यों")
_PROBLEM_HI = ("नहीं", "नही", "प्रॉब्लम", "दिक्कत", "मुश्किल", "लेट", "सॉरी")
_YES_HI = ("हाँ", "हां", "जी", "ठीक", "बिल्कुल", "ओके", "हम्म")


def filler_kind(text: str) -> str:
    t = (text or "").strip()
    if _Q.search(t) or any(w in t for w in _Q_HI):
        return "question"
    if _PROBLEM.search(t) or any(w in t for w in _PROBLEM_HI):
        return "problem"
    if _YES.search(t) or t.startswith(_YES_HI):
        return "yes"
    return "other"


def trim_silence(frame: rtc.AudioFrame, threshold: int = 300) -> rtc.AudioFrame:
    """Cut the quiet start and end of a recorded filler so it starts the moment it is played."""
    pcm = np.frombuffer(frame.data, dtype=np.int16).reshape(-1, frame.num_channels)
    loud = np.where(np.abs(pcm).max(axis=1) > threshold)[0]
    if loud.size == 0:
        return frame
    pad = int(frame.sample_rate * 0.04)
    start, end = max(0, loud[0] - pad), min(len(pcm), loud[-1] + pad)
    cut = np.ascontiguousarray(pcm[start:end])
    return rtc.AudioFrame(cut.tobytes(), frame.sample_rate, frame.num_channels, len(cut))


def split_frames(frame: rtc.AudioFrame) -> list[rtc.AudioFrame]:
    """20 ms frames, like the rest of the reply audio."""
    bs = utils.audio.AudioByteStream(frame.sample_rate, frame.num_channels, samples_per_channel=frame.sample_rate // 50)
    return bs.push(bytes(frame.data)) + bs.flush()


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
        self.fillers_used = 0
        self.posted = False


class OnboardingCaller(Agent):
    def __init__(self, state: CallState, tts: sarvam.TTS):
        super().__init__(instructions=scripts.instructions(state.meta))
        self.state = state
        self._tts = tts
        self._clips: dict[tuple[str, str], list[rtc.AudioFrame]] = {}
        self._turn_done_at: float | None = None   # when the candidate's last turn ended (None while they talk)
        self._turn_kind = "other"
        self._turn_words = 0
        self._filler_for: float | None = None     # the turn that already got its filler

    # --- fillers -------------------------------------------------------------------------------------------
    def on_user_state(self, ev) -> None:
        if ev.new_state == "speaking":
            self._turn_done_at = None  # a new turn has started: nothing to fill yet

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        text = new_message.text_content or ""
        self._turn_kind = filler_kind(text)
        self._turn_words = len(text.split())
        self._turn_done_at = time.monotonic()

    async def prepare_fillers(self, language: str) -> None:
        """Record every filler for this language once (a few hundred characters of Sarvam voice)."""
        for words in FILLERS.get(language, FILLERS["en-IN"]).values():
            for w in words:
                if (language, w) in self._clips:
                    continue
                try:
                    frame = await self._tts.synthesize(w).collect()
                    self._clips[(language, w)] = split_frames(trim_silence(frame))
                except Exception as e:  # a missing filler only means no filler
                    logger.warning("filler %r not recorded: %s", w, e)

    def _pick_filler(self) -> list[rtc.AudioFrame] | None:
        lang = self.state.language
        options = FILLERS.get(lang, FILLERS["en-IN"])
        words = [w for w in options.get(self._turn_kind, options["other"]) if (lang, w) in self._clips]
        if not words:
            return None
        fresh = [w for w in words if w != self.state.last_filler] or words
        choice = random.choice(fresh)
        self.state.last_filler = choice
        self.state.fillers_used += 1
        return self._clips[(lang, choice)]

    def _filler_due(self) -> bool:
        done = self._turn_done_at
        wait = FILLER_AFTER if self._turn_words >= 2 else SHORT_AFTER
        return done is not None and self._filler_for != done and time.monotonic() - done >= wait

    async def tts_node(self, text, model_settings):
        """The reply's audio. If the candidate has stopped speaking and the first words of the reply are not ready
        within FILLER_AFTER, a short filler is played first, as part of this same reply (never after it)."""
        frames: asyncio.Queue = asyncio.Queue()

        async def pump() -> None:
            try:
                async for f in Agent.default.tts_node(self, text, model_settings):
                    await frames.put(f)
            finally:
                await frames.put(None)

        task = asyncio.create_task(pump())
        getter = asyncio.ensure_future(frames.get())
        waiting = True  # still waiting for the first real audio
        try:
            while True:
                if waiting:
                    done, _ = await asyncio.wait({getter}, timeout=0.05)
                    if not done:
                        if self._filler_due():
                            self._filler_for = self._turn_done_at
                            clip = self._pick_filler()
                            for f in clip or []:
                                yield f
                            waiting = False
                        continue
                    waiting = False
                f = await getter
                if f is None:
                    break
                yield f
                getter = asyncio.ensure_future(frames.get())
        finally:
            getter.cancel()
            task.cancel()

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
        asyncio.create_task(self.prepare_fillers(language))
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
    session.on("user_state_changed", agent.on_user_state)

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
    asyncio.create_task(agent.prepare_fillers(state.language))  # recorded while the greeting plays


if __name__ == "__main__":
    cli.run_app(server)
