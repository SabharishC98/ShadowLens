"""
PyTorch hotfix for older versions of torch that lack float8_e8m0fnu attribute.
Import this at the very top of execution entry points to avoid Hugging Face transformers import crashes.
"""
import torch

if not hasattr(torch, "float8_e8m0fnu"):
    setattr(torch, "float8_e8m0fnu", torch.float32)
