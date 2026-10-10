# DSH native vision on Fred

The active `cfrproxy` model `fred/flash-next` accepts native image input. Relay already sends PNG/JPEG/WebP/GIF attachments as native image blocks, including steering. The Fred web profile explicitly declares `input: [text, image]` for this exact model; do not infer the same metadata for every alias.

For images already in a conversation, the model should inspect them directly. For local screenshots, use DSH's `read_image({file_path: ...})`; it returns image content to the current model. The optional `vision_glance` toolkit uses a separate provider and credential. Its missing `ANIONEX_FREE_VISION` credential is not evidence that Flash Next lacks vision.

On 2026-10-09, an isolated native DSH Haxor session using `fred/flash-next` accepted a Relay app icon and described its speech-bubble geometry and colors. This confirms live image admission and inference, beyond mocked attachment transport.

Host configuration corrections were saved in:

- `~/.dsh/.agent-presets/haxor/agent.cordis.yml`: replace the misleading filename-only/blind instruction with native `read_image` guidance.
- `~/.dsh/.agent-presets/haxor/skills/local-vision/SKILL.md`: DSH-specific native image guidance takes precedence over manual endpoint fallbacks.

Both have `.before-native-vision-20261009` backups. These are local deployment settings, not files shipped by Relay. The live DSH host retains its loaded persona: inspection of the isolated session's system message still showed the old text. A coordinated DSH reload is required for the saved persona change; do not restart the host while users have running turns just to refresh this guidance. The skill file correction is available on the next fresh skill read. Existing conversation history can still contain earlier incorrect claims.

A second isolated turn called native `read_image` on the local app-icon PNG, returned `isError: false`, and completed with a matching pixel-based description. This verifies both native attachment inference and local-file image inspection on the live Flash Next route. It does not prove that existing sessions will stop choosing `vision_glance` before their persona is reloaded.
