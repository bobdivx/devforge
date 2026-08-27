# QLoRA fine-tune for the Relanceur adapter.
# Run on a Windows/Linux GPU host (NVIDIA). Do NOT add this service to ZimaOS/NAS compose:
# the NAS has no GPU. The resulting GGUF is registered in the Ollama already serving DevForge.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/output/.cache/huggingface \
    TOKENIZERS_PARALLELISM=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        git \
        cmake \
        ninja-build \
        build-essential \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

WORKDIR /opt/qlora

COPY requirements.txt train.py ./

RUN pip install --upgrade pip \
    && pip install torch --index-url https://download.pytorch.org/whl/cu124 \
    && pip install -r requirements.txt \
    && pip install unsloth

VOLUME ["/data", "/output"]

ENTRYPOINT ["python", "/opt/qlora/train.py"]
CMD ["--input", "/data/agent-sft.jsonl", "--output", "/output"]
