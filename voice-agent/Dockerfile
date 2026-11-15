# TCMPL onboarding voice agent for LiveKit Cloud (deploy: lk agent create --region ap-south)
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN useradd --create-home --uid 10001 appuser
WORKDIR /home/appuser/app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY agent.py scripts.py ./
USER appuser
# Voice-activity model baked into the image so calls start fast
RUN python agent.py download-files
CMD ["python", "agent.py", "start"]
