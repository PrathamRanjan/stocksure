# Training the in-browser scam model

This folder is the training code for the scam text model that StockSure runs **in the browser**
(`public/safety/model/model_quantized.onnx`, 23 MB), and for the payment-risk model (`public/safety/risk_lgbm.json`).

| File | What it does |
|---|---|
| `scripts/prepare.py` | Loads and deduplicates about 80k public SMS, Telegram and email messages, splits them, and adds weak tactic labels from regex seeds |
| `scripts/gen_business.py` | Writes the 600 author-written business-scam and hard-genuine rows (template split, so test templates are never trained on) |
| `scripts/train_text.py` | SetFit contrastive fine-tune of `sentence-transformers/all-MiniLM-L6-v2`, then a 3-way head (genuine / marketing / scam) and nine tactic heads; ONNX export with int8 dynamic quantisation |
| `scripts/refit_heads_onnx.py` | Refits the heads on the int8 graph's own embeddings, so the browser and Python agree |
| `scripts/train_risk.py` | The monotone LightGBM payment-risk model, trained on **synthetic** payments |
| `browser/` | The browser runtime (WordPiece tokenizer, ONNX client, risk client) and the parity test against Python |
| `reports/` | Training logs and the measured results on frozen test sets |
| `MODEL_CARD.md`, `SOURCES.md` | Results, weaknesses, and every dataset with its licence |

The raw data (229 MB), checkpoints and full-precision models (1.7 GB) are not committed. `SOURCES.md` says where
each dataset comes from. Paths inside these files refer to the original `guard-lab/` training folder.
