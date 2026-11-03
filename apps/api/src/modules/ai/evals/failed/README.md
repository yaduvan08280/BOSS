# Answers that did not pass

Recorded by `AI_EVAL_RECORD=1` on 03/11/2026 with **qwen2.5:7b** (Ollama, CPU, after one repair round).
Kept as evidence, not replayed by `npm test`.

- `leadToOrder.json`: 11 steps, every branch sound, but three steps have no person
  (the trial-order and PO waits, and "Negotiate price"), and "need confirmed?" never became a decision.
- `complaint.json` (Hindi): the "No" of "verify complaint" leads to a step that does not exist.

A small local model is not enough for "Build with AI" on its own; the default (Claude Opus 5.5)
is what the acceptance is measured on. Run the live evals with a real key before go-live.
