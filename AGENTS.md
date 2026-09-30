# KsNote — Agent Guide

KsNote is a local-first notes app (Electron + React/TipTap + SQLite) with an
MCP server that lets coding agents read and edit pages and diagrams.

## Connect

Local (STDIO):

```bash
codex mcp add ksnote --env KSNOTE_DB_PATH=/path/to/ksnote.db -- node /path/to/note/mcp/ksnote-server.mjs
```

Remote (Streamable HTTP):

```json
{
  "mcpServers": {
    "ksnote": {
      "type": "streamable-http",
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer <KSNOTE_MCP_TOKEN>" }
    }
  }
}
```

Health: `GET /health` (no auth).

## Tool workflow (must follow)

1. Copy the explicit target: `ksnote://page/<pageId>?block=<blockId>&offset=<o>&revision=<r>&operation=<op>`.
   Explicit `targetRef` always wins over live cursor state.
2. `note_get` first. Pass its `revision` as `expectedRevision` on every write.
3. Writes return `awaiting_approval` + `operationId`. They apply only after the
   user approves in the KsNote app. Poll `operation_get` until
   `completed`, `error`, or `expired`.
4. On `revision_conflict`: re-read with `note_get`, use the new revision, retry.
5. Failed operations carry `retry{retryable,hint,maxAttempts}`. When retryable,
   fix the cause and retry at most 2 more times, then report the structured
   error instead of looping.

## Tool cheat sheet

- Read: `workspace_get_context`, `project_list`, `note_get`, `note_search`
  (ranked, `score`+`snippet`, pagination), `diagram_capabilities`,
  `task_query`, `asset_get`, `history_list`
- Write (approval required): `note_create`, `text_insert`, `diagram_insert`
  (`mermaid`|`plantuml`|`drawio`, real render verification),
  `diagram_delete`, `note_patch` (one block by stable `blockId`),
  `note_move`, `task_update`, `history_restore`
- Ops: `operation_get`

Rejection codes: `workspace_mismatch` (use the matching `KSNOTE_DB_PATH`),
`revision_conflict`, `diagram_target_required`, `patch_block_not_found`,
`task_not_found`, `asset_not_found`, `note_not_found`, `project_not_found`,
`operation_expired`.

## Diagrams

- Mermaid: flows, sequences, state, ERD, code architecture (built in).
- PlantUML: UML (needs local Java + bundled JAR).
- draw.io: manual layout (needs diagrams.net network).
- Use `diagram_capabilities` before auto-selecting a format.

## Develop

- `npm run test:mvp` (node:test, must stay green), `npm run build`
- Shared logic lives in pure `.mjs` modules under `mcp/` and `src/`
  (`target-ref`, `note-html`, `note-search`, `history`, `operation-retry`,
  `block-anchor`) with unit tests under `tests/`.
- Renderer wiring is covered by source-grep regression tests in
  `tests/editor-source-regressions.test.mjs`.
- Never commit `release-*/`, `packaged-mcp-test/`, or `.openchrome/` artifacts.
