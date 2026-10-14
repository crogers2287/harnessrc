# Rich chat responses

Relay uses the real MIT OpenUI renderer (`@openuidev/react-ui` 0.17.0 and `@openuidev/react-lang` 0.3.2). This is a response feature, independent of the composer controls.

## Available components

Assistant replies can contain OpenUI cards, tabs, accordions, carousels, steps, callouts, syntax-highlighted code, tables, editable tables, line/bar/area/pie/radar/scatter charts, forms, choices, date pickers and sliders. The installed library supplies the component signatures and validates output. Ordinary Markdown remains ordinary Markdown; a user pasting a code example does not create an interactive assistant response.

Read the exact generation contract at `/openui-guide.txt` on your Relay gateway or `apps/web/public/openui-guide.txt`. Regenerate after a dependency upgrade with `node --import tsx scripts/openui-guide.ts`. The contract uses actual installed library signatures rather than guessed APIs.

Wrap source in an `openui` fenced block inside an assistant reply:

````text
Here are the render timings:
```openui
heading = CardHeader("Render comparison", "Same seed")
chart = BarChart(["Turbo", "Teacher"], [Series("Seconds", [25, 236])])
table = Table([Col("Model", ["Turbo", "Teacher"]), Col("Steps", [8, 40], "number")])
root = Stack([heading, chart, table])
```
````

Alternatively save the declarative source as `result.openui` and publish it:

```sh
relay-artifact --session EXACT_RELAY_OR_NATIVE_SESSION_ID --file result.openui --title "Render comparison"
```

Publication uses the existing authenticated, audited, durable and idempotent artifact API. Files require a root statement and are bounded to 100 KB. Rich blocks also have a 100 KB display limit. Invalid output shows a source/error disclosure instead of disappearing.

## Interactions and permissions

Form submissions and `@ToAssistant` actions populate the composer for review. They never send automatically, change permissions, or resolve native approval requests. Native questions retain their exact interaction broker response route. Client-side reactive bindings, sorting, filtering and modal state work within the renderer. Form state survives row virtualization in session-local storage.

There is no `toolProvider`: arbitrary Query/Mutation calls and pipeline execution are unavailable to generated UI. Pipeline commands still run through the agent's authorized harness. HTML/JS/SVG artifacts remain downloads, not executable pages. Native generated-artifact links cannot navigate the embedded document, and neither can launch external apps.

## Media and downloads

DSH `present` references and explicitly named assistant Markdown file links resolve through `/api/sessions/:session/media/:event/:index`, authenticated to the exact native session. Image indices retain their historical ordering. A process replacement cannot serve a stale event's file. User/tool prose and code fences do not grant file access.

Video and audio play inline with controls; videos support fullscreen and byte-range seeking. Published attachments use the same passive media policy. Images have a larger preview and save controls. Other files download; Markdown file links never fall back to the SPA. All native file reads and published uploads remain bounded to 20 MB. Larger pipeline files need a future streaming/storage implementation rather than pretending this path is unlimited.

## Android

The app stays Kotlin/Compose: navigation, session controls, editor, voice, image paste, downloads and media playback remain native. Only the rich OpenUI artifact has a bundled, isolated rendering surface, so the same charts/forms/components run on both clients. It has no arbitrary network, file/content access, gateway cookies, tool execution or popup privileges. An interceptor can read only image bytes from exact media/attachment routes in the current authorized conversation. Use relative `/api/sessions/.../attachments/...` image URLs from published artifacts. Its bridge accepts only a bounded draft and measured height. The renderer is bundled into the signed APK by `scripts/build-android.py`; no CDN or remote generated code is loaded.

Physical-device checks remain required for playback codecs, seek/fullscreen, downloads through Android's document picker, keyboard focus and nested chart/form gestures. Browser coverage is not native-device verification.
