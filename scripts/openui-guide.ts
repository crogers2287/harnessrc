/** Regenerate the harness output contract from the exact installed MIT OpenUI library. */
import { openuiLibrary, openuiPromptOptions } from '@openuidev/react-ui/genui-lib';
import { writeFileSync } from 'node:fs';
const prompt = openuiLibrary.prompt(openuiPromptOptions).replace(/^You are[^\n]+\n/, '');
writeFileSync(
  'apps/web/public/openui-guide.txt',
  `Relay rich response format (OpenUI react-ui 0.17.0 / react-lang 0.3.2).
Put declarative UI in a fenced code block with language openui. Ordinary prose may appear outside it.
Alternatively save the openui-lang source as a .openui file and publish with relay-artifact --session EXACT_SESSION_ID --file output.openui --title TITLE.
Use embedded data. Query/Mutation/tool execution and @OpenUrl are unavailable. @ToAssistant and form submissions add a draft for the user to review; they never auto-send or resolve native approvals.
For images/video/audio publish actual output bytes with relay-artifact or DSH present. In DSH prose use explicit Markdown paths. Video/audio are played by Relay's authenticated native media cards. Never embed arbitrary HTML/JS or credentials in a response.
${prompt}`,
);
