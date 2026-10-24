# DSH conversation layout experiment

Branch: `experiment/dsh-conversation-layout`.
Baseline: `5043fda` (Relay 0.1.36). Android preview: `0.1.37-dsh-preview`.
The production gateway and published production APK remain on the baseline.

Reading this as: a coding-agent workspace for developers supervising a parent and
its delegated work, with the compact conversation navigation shown in the supplied
DSH screenshot, targeting React web/PWA and native Kotlin Android.

Design dials: variance 3, motion 2, density 6. This experiment changes navigation
and hierarchy rather than adding decorative surfaces. It uses the existing
system sans typeface and semantic themes: light surface `#ffffff`, canvas
`#f5f7f8`, text `#15272c`, secondary text `#53676e`, accent `#246b60`, and border
`#d9e2e5`. Dark and AMOLED continue using their existing theme roles.

```text
Workspace sidebar | Parent session / selected conversation [v]
  Folder          | Main conversation / delegated agent     Chat | Activity
    Parent        | ------------------------------------------------------
    Parent        | Selected conversation, readable measure
                  | (agent messages and activity stay separate)
                  | ------------------------------------------------------
                  | Parent composer OR explicit view-only agent footer
```

The supplied reference guides the flat sidebar, workspace grouping, selected-agent
picker and quiet tabs. A uniform grid of session cards would obscure parent/child
relationships, so it is deliberately replaced by compact rows. Desktop keeps the
list/detail split. Phones retain the left session drawer and use a searchable
conversation dialog (web) or native bottom sheet (Android), with visible controls
and system Back/Escape. Touch targets remain at least 48px/48dp.

## Behavior

- The conversation picker is directly below the session header. Main conversation
  and native linked children share one searchable list with model, observed status
  and last update. Unreported status is **Recorded**, not a fabricated running or
  finished indicator. Native child status is displayed for DSH.
- Chat and Activity switch the visible transcript. Child conversations are view
  only; there is no child composer, permission selector or separate session writer.
  Parent drafts and conversation scroll are retained while inspecting children.
- Child history refreshes every three seconds, with stable identities, earlier
  history paging, separate histories and a Latest messages control. Web child URLs
  carry the parent, child and selected tab and survive reload. Android uses local
  saveable navigation and system Back to the parent.
- Workspace grouping defaults on for fresh preferences. Existing choices remain.
  DSH children are omitted as separate sidebar rows only when the matching parent
  is also in the filtered list; searching for a child alone still finds it.
- Claude/Codex use the existing verified native transcript linkage. DSH carries
  its verified native parent into the protocol, then reads through the existing
  DSH adapter. DSH catalogs check both parent and child read permissions; matching
  titles, directories, models or host names never establish parenthood. Child
  event routes revalidate the exact relation and child permission.

## Testing and preview

Run checks from the repository root:

```sh
npm run check
RC_E2E_PORT=4191 npx playwright test -g 'DSH layout switches|agent tasks show native checklist'
apps/android/gradlew -p apps/android :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
python3 scripts/build-android.py
```

Use an isolated gateway/database and a disposable emulator for preview fixtures.
Do not run native instrumentation against an installed user app: it clears fixture
state. The signed preview APK uses the same app ID and signing identity so it can
update the installed app while retaining its connection and drafts. Installing
it is optional; it does not change the gateway. DSH native linked-child discovery
requires the corresponding gateway branch; Claude/Codex child navigation uses the
existing production endpoints.

Validation: 214 backend tests, TypeScript, ESLint and the web build pass.
Seven browser flows cover the new picker, isolated child history, live refresh,
reload/deep links, draft recovery, approvals/Queue, browser Back, live parent
scrolling and the existing DSH filters. The picker passed axe accessibility
checks; screenshots were inspected at 320/375/430/768/1440px, with light and dark
child views. Native unit tests, lint and all 34 instrumentation checks pass on a disposable
emulator. The final focused navigation check also passes after the selected-tab
indicator and keyboard-aware sheet polish. The signed release APK builds and its
signature verifies.

Screenshots:

- [Desktop conversation picker](screenshots/dsh-layout-picker-desktop.png)
- [Phone main conversation](screenshots/dsh-layout-chat-mobile.png)
- [Dark child conversation](screenshots/dsh-layout-agent-dark.png)
- [Native conversation picker](screenshots/dsh-layout-native-picker.png)
- [Native search with keyboard](screenshots/dsh-layout-native-keyboard.png)
- [Native child chat](screenshots/dsh-layout-native-chat.png)

Real device edge gestures, TalkBack and OS keyboard variations remain physical-device checks.
