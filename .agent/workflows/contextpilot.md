# /contextpilot workflow

Trigger: when user types /contextpilot or asks about the chrome extension

1. Check current file structure matches the spec in CURSOR_PROMPT.md
2. If any file uses import/export at top level outside background.js → flag as error
3. If background.js has type:module → flag as error
4. Run: validate manifest permissions include tabs, scripting, storage, alarms
5. Check vendor/d3.min.js and vendor/gpt-tokenizer.js exist and are NOT CDN urls
6. Report all issues with exact file:line references
