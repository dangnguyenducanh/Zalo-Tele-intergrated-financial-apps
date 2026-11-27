# The Qwen receipt service (docs/06 §6.6). The pinned vLLM image already has Python 3.12, FastAPI, Uvicorn, httpx,
# python-multipart, Pydantic and Pillow (and pytest for the tests), so nothing is installed.
FROM vllm/vllm-openai@sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3
WORKDIR /app
COPY app.py picker.py reader.py vllm_client.py ./
USER 65534:65534
# Loopback only: the compose file uses the host network, and the tunnel is the only way in from outside.
ENTRYPOINT ["python3", "-B", "-m", "uvicorn", "app:create_app", "--factory", "--host", "127.0.0.1"]
CMD ["--port", "8290"]
