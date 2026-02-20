# FayeVoice Troubleshooting

## Mic Not Picking Up Audio

### macOS
- System Settings → Privacy & Security → Microphone → Terminal must be ON
- If `rec` produces 0-byte files, the threshold may be too high. Lower `silence_threshold` in config (try `0.3%` or `0.1%`)
- Test mic manually: `rec test.wav trim 0 3` — file should be >50KB

### Linux
- Check `arecord -l` to verify mic is detected
- May need to set default input: `pactl set-default-source <source-name>`

## Wake Word Not Detected
- Check terminal output for `[heard: ...]` lines — this shows what the STT is transcribing
- Common misheard variants: "bay arise", "bey arise", "they arrive", "fate arise"
- Add variants to `wake_word_variants` in config
- Speak clearly and at normal volume, ~2-3 feet from mic

## No Audio Playing Through Speaker
- macOS: Check System Settings → Sound → Output is set to correct device (Bluetooth speaker, etc.)
- Test manually: `afplay /System/Library/Sounds/Ping.aiff`
- For Bluetooth speakers: ensure connected before running scripts

## SSH Connection Issues (Remote Speaker)
- Verify SSH key permissions: `chmod 600 ~/.ssh/id_ed25519`
- Test: `ssh -o ConnectTimeout=5 user@host "echo ok"`
- If IP changed: scan with `arp -a` or check router DHCP leases
- macOS SSH key perms on Windows: use `icacls` to restrict to owner only

## ElevenLabs API Errors
- Verify key: `curl -s https://api.elevenlabs.io/v1/user -H "xi-api-key: YOUR_KEY"`
- Check quota: free tier has limited characters/month
- Rate limits: add small delays between rapid TTS calls
