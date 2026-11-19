"""Rebuild the bundled CLIP subject vectors from the pinned text encoder."""
import argparse
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text_model")
    parser.add_argument("tokenizer")
    args = parser.parse_args()
    assets = Path(__file__).resolve().parents[1] / "vision"
    labels = json.loads((assets / "subjects.json").read_text(encoding="utf-8"))
    tokenizer = Tokenizer.from_file(args.tokenizer)
    tokenizer.no_padding()
    encoder = ort.InferenceSession(args.text_model, providers=["CPUExecutionProvider"])
    vectors = []
    for label in labels:
        examples = []
        for prompt in label["prompts"]:
            ids = tokenizer.encode(prompt).ids
            data = encoder.run(["text_embeds"], {"input_ids": np.array([ids], dtype=np.int64)})[0][0]
            examples.append(data / np.linalg.norm(data))
        mean = np.mean(examples, axis=0)
        vectors.append(mean / np.linalg.norm(mean))
    np.asarray(vectors, dtype="<f4").tofile(assets / "subjects.f32")

if __name__ == "__main__":
    main()
