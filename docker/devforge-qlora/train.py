#!/usr/bin/env python3
"""Unsloth QLoRA 4-bit fine-tune of Qwen2.5-Coder-7B-Instruct on ChatML JSONL.

Input lines: {"messages":[{"role":"system|user|assistant","content":"..."}]}
Outputs: LoRA adapter, GGUF q4_k_m, and a Modelfile named devforge-relanceur.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


MODEL_NAME = "unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit"
OLLAMA_MODEL = "devforge-relanceur"
LORA_R = 16
MAX_SEQ_LENGTH = 2048

SYSTEM_DEFAULT = (
    "Tu es l'agent Relanceur DevForge \u2014 un op\u00e9rateur DevOps autonome "
    "qui r\u00e9pare les d\u00e9ploiements \u00e9chou\u00e9s via la boucle observe \u2192 fix \u2192 verify."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="QLoRA Relanceur fine-tune (Unsloth 4-bit)")
    parser.add_argument("--input", required=True, help="ChatML JSONL (messages[])")
    parser.add_argument("--output", required=True, help="Output directory (adapter + gguf + Modelfile)")
    parser.add_argument("--model", default=os.environ.get("QLORA_BASE_MODEL", MODEL_NAME))
    parser.add_argument("--max-seq-length", type=int, default=MAX_SEQ_LENGTH)
    parser.add_argument("--lora-r", type=int, default=LORA_R)
    parser.add_argument("--max-steps", type=int, default=int(os.environ.get("QLORA_MAX_STEPS", "60")))
    parser.add_argument("--epochs", type=float, default=float(os.environ.get("QLORA_EPOCHS", "0")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("QLORA_BATCH", "2")))
    parser.add_argument("--grad-accum", type=int, default=int(os.environ.get("QLORA_GRAD_ACCUM", "4")))
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    return parser.parse_args()


def validate_jsonl(path: Path) -> int:
    if not path.is_file():
        raise FileNotFoundError(f"JSONL introuvable: {path}")
    n = 0
    with path.open(encoding="utf-8") as handle:
        for lineno, raw in enumerate(handle, 1):
            line = raw.strip()
            if not line:
                continue
            row = json.loads(line)
            messages = row.get("messages")
            if not isinstance(messages, list) or not messages:
                raise ValueError(f"Ligne {lineno}: 'messages' manquant ou vide")
            for msg in messages:
                role = msg.get("role")
                if role not in ("system", "user", "assistant"):
                    raise ValueError(f"Ligne {lineno}: role invalide {role!r}")
                if not isinstance(msg.get("content"), str):
                    raise ValueError(f"Ligne {lineno}: content doit etre une chaine")
            n += 1
    if n == 0:
        raise ValueError(f"JSONL vide: {path}")
    return n


def write_modelfile(output: Path, gguf_name: str) -> Path:
    parts = [
        f"FROM ./{gguf_name}",
        "TEMPLATE \"\"\"{{ if .System }}<|im_start|>system",
        "{{ .System }}<|im_end|>",
        "{{ end }}{{ if .Prompt }}<|im_start|>user",
        "{{ .Prompt }}<|im_end|>",
        "{{ end }}<|im_start|>assistant",
        "{{ .Response }}<|im_end|>",
        "\"\"\"",
        "PARAMETER stop \"<|im_start|>\"",
        "PARAMETER stop \"<|im_end|>\"",
        "PARAMETER temperature 0.3",
        f"SYSTEM \"\"\"{SYSTEM_DEFAULT}\"\"\"",
        "",
    ]
    body = "\n".join(parts)
    (output / "Modelfile").write_text(body, encoding="utf-8")
    named = output / OLLAMA_MODEL
    named.write_text(body, encoding="utf-8")
    return named


def find_gguf(root: Path) -> Path | None:
    matches = sorted(root.rglob("*.gguf"))
    preferred = [p for p in matches if "q4_k_m" in p.name.lower() or "q4_k" in p.name.lower()]
    if preferred:
        return preferred[0]
    return matches[0] if matches else None


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    adapter_dir = output / "adapter"
    gguf_dir = output / "gguf"
    adapter_dir.mkdir(parents=True, exist_ok=True)
    gguf_dir.mkdir(parents=True, exist_ok=True)

    n = validate_jsonl(input_path)
    print(
        f"[qlora] {n} conversation(s) ChatML -- base={args.model} "
        f"r={args.lora_r} seq={args.max_seq_length}",
        flush=True,
    )

    import torch
    from datasets import load_dataset
    from unsloth import FastLanguageModel

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=args.lora_r,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )

    try:
        from unsloth.chat_templates import get_chat_template

        tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")
    except Exception as exc:
        print(f"[qlora] chat_template qwen-2.5 non applique ({exc})", flush=True)

    dataset = load_dataset("json", data_files={"train": str(input_path)}, split="train")

    def formatting_prompts_func(examples):
        convos = examples["messages"]
        texts = [
            tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False)
            for convo in convos
        ]
        return {"text": texts}

    dataset = dataset.map(formatting_prompts_func, batched=True)

    from trl import SFTConfig, SFTTrainer

    use_bf16 = bool(getattr(torch.cuda, "is_bf16_supported", lambda: False)())
    config_kwargs = dict(
        output_dir=str(output / "trainer"),
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        warmup_steps=5,
        learning_rate=args.learning_rate,
        logging_steps=1,
        fp16=not use_bf16,
        bf16=use_bf16,
        seed=3407,
        report_to="none",
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        packing=False,
    )
    if args.epochs and args.epochs > 0:
        config_kwargs["num_train_epochs"] = args.epochs
    else:
        config_kwargs["max_steps"] = max(1, args.max_steps)

    sft_args = SFTConfig(**config_kwargs)
    trainer_kwargs = dict(model=model, train_dataset=dataset, args=sft_args)
    try:
        trainer = SFTTrainer(processing_class=tokenizer, **trainer_kwargs)
    except TypeError:
        trainer = SFTTrainer(tokenizer=tokenizer, **trainer_kwargs)

    trainer.train()

    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"[qlora] adapter -> {adapter_dir}", flush=True)

    print("[qlora] export GGUF q4_k_m...", flush=True)
    model.save_pretrained_gguf(
        str(gguf_dir),
        tokenizer,
        quantization_method="q4_k_m",
    )

    gguf = find_gguf(gguf_dir) or find_gguf(output)
    if gguf is None:
        raise RuntimeError("Aucun fichier GGUF n'a ete produit.")

    staged = output / gguf.name
    if gguf.resolve() != staged.resolve():
        shutil.copy2(gguf, staged)

    named = write_modelfile(output, staged.name)
    print(f"[qlora] GGUF -> {staged}", flush=True)
    print(
        f"[qlora] Modelfile -> {output / 'Modelfile'} et {named} "
        f"(ollama create {OLLAMA_MODEL})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[qlora] echec: {exc}", file=sys.stderr)
        raise
