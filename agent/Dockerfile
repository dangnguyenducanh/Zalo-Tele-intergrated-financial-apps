# The agent service image (docs/06 §6.13). The build context is agent/ (docker-compose.yml: build: .) and the code is
# copied to /app/agent, so the import path is `agent.` here as in the tests and in `python -m agent.setup`.
FROM python:3.12.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
# Only this image installs requirements-model.txt (sentence-transformers and torch); CI never does.
COPY requirements.txt requirements-model.txt agent/
RUN pip install -r agent/requirements.txt -r agent/requirements-model.txt
COPY . agent/
# Loopback only: the compose file uses the host network, and the tunnel is the only way in from outside.
# No access log: our own log line carries the request id, and no query string or address is written anywhere.
CMD ["python", "-m", "uvicorn", "agent.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "8310", "--no-access-log"]
