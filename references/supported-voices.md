# Supported Voice Recommendations

Use `scripts/voice-picker.sh` to browse your account voices and set one as default.

Recommended profile defaults for reliable wake-response loops:

1. Narrator Warm
- Model: `eleven_multilingual_v2`
- Stability: `0.4`
- Similarity Boost: `0.8`
- Style: `0.7`

2. Precision Assistant
- Model: `eleven_multilingual_v2`
- Stability: `0.55`
- Similarity Boost: `0.75`
- Style: `0.45`

3. Fast Conversational
- Model: `eleven_multilingual_v2`
- Stability: `0.35`
- Similarity Boost: `0.82`
- Style: `0.6`

Notes:
- Keep wake words to 2-3 distinct words.
- Add obvious misheard variants in lowercase.
- Re-test with `POST /v1/speak/test` after voice changes.
