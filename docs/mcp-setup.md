# KsNote MCP 서버 설정 가이드

KsNote 는 자기 저장소(SQLite)를 그대로 노출하는 MCP 서버를 함께 제공합니다.
Codex 같은 MCP 클라이언트가 노트를 **검색·열람**하고, **수정은 승인 큐를 거쳐서만** 반영합니다.

- 서버 파일: `mcp/ksnote-server.mjs` (STDIO transport, 추가 npm 의존성 없음)
- 프로토콜: JSON-RPC 2.0 / MCP `2025-06-18` (클라이언트가 `2025-03-26`·`2024-11-05` 를 요구하면 그 버전으로 응답)
- 저장소: Electron userData 의 `ksnote.db` — 앱과 서버가 같은 파일을 파일 락으로 공유합니다.

## 1. 설치

### 방법 A — KsNote 설정 UI (권장)

1. KsNote 실행 → **설정 > MCP 연결**
2. 맨 위 **KsNote MCP 서버** 카드에서 상태가 `정상` 인지, 도구 12개가 보이는지 확인
3. **Codex 설정 파일 생성** 클릭 → `~/.codex/config.toml` 의 `[mcp_servers.ksnote]` 항목만 생성/갱신
   (기존 파일이 있으면 `config.toml.bak` 백업을 남기고, 다른 MCP 서버 설정은 건드리지 않습니다)

### 방법 B — codex CLI

```bash
codex mcp add ksnote -- node "<저장소 절대경로>/mcp/ksnote-server.mjs"
```

DB 경로를 명시하려면 인자를 덧붙입니다.

```bash
codex mcp add ksnote -- node "<저장소>/mcp/ksnote-server.mjs" --db "C:/Users/<user>/AppData/Roaming/ksnote/ksnote.db"
```

### 방법 C — 설정 파일 직접 편집

전역 `~/.codex/config.toml`:

```toml
[mcp_servers.ksnote]
command = "node"
args = ["C:/Users/<user>/IdeaProjects/note-pr/mcp/ksnote-server.mjs", "--db", "C:/Users/<user>/AppData/Roaming/ksnote/ksnote.db"]
```

저장소 안에서만 쓸 프로젝트 설정은 이미 `.codex/config.toml` 로 커밋되어 있습니다.

```toml
[mcp_servers.ksnote]
command = "node"
args = ["mcp/ksnote-server.mjs"]
```

## 2. DB 경로 규칙

우선순위는 `--db 인자` > `KSNOTE_DB 환경변수` > 플랫폼 기본값입니다.

| 플랫폼 | 기본 경로 |
| --- | --- |
| Windows | `%APPDATA%/ksnote/ksnote.db` |
| macOS | `~/Library/Application Support/ksnote/ksnote.db` |
| Linux | `~/.config/ksnote/ksnote.db` |

## 3. Tool 카탈로그

| Tool | 용도 | 승인 필요 |
| --- | --- | --- |
| `workspace_get_context` | 현재 열린 노트·선택 영역·워크스페이스 규모·최근 노트 10건 | 아니오 (읽기) |
| `project_list` | 프로젝트 목록 + 노트 수 | 아니오 (읽기) |
| `note_search` | 제목·본문 검색 (score·snippet 포함) | 아니오 (읽기) |
| `note_get` | 노트 본문 (html/markdown/blocks, blockRange·heading 범위) | 아니오 (읽기) |
| `task_query` | 체크리스트 항목 조회 (프로젝트·노트·완료여부) | 아니오 (읽기) |
| `asset_get` | 첨부파일 메타데이터 + 실제 경로 + 존재 여부 | 아니오 (읽기) |
| `history_list` | 노트 revision 목록 + currentRevision | 아니오 (읽기) |
| `note_create` | 새 노트 생성 요청 | **예** |
| `note_patch` | 블록 단위 수정 요청 (expected_revision 필요) | **예** |
| `note_move` | 다른 프로젝트로 이동 요청 | **예** |
| `task_update` | 할 일 체크 상태 변경 요청 | **예** |
| `history_restore` | 이전 revision 으로 복원 요청 (expected_revision 필요) | **예** |

모든 목록 도구는 `{ items, total, nextOffset }` 형태로 답하고, `nextOffset` 이 `null` 이면 마지막 페이지입니다.
읽기 도구에는 `readOnlyHint: true`, 쓰기 도구에는 `readOnlyHint: false` 가 붙고
`note_patch` · `history_restore` 는 본문을 통째로 바꾸므로 `destructiveHint: true` 입니다.

## 4. 승인 흐름

```
Codex --tools/call--> MCP 서버 --enqueue--> pending_writes (SQLite)
                                                 |
                          KsNote 상단 "MCP 쓰기 요청 N건" 배너
                                                 |
                              승인 -> revision 스냅샷 -> 노트 반영
                              거절 -> status=rejected (노트 변경 없음)
```

1. 쓰기 도구는 노트를 **직접 바꾸지 않습니다**. 변경안을 diff 로 만들어 `pending_writes` 에 넣고
   `{ "status": "pending_approval", "changeId": "...", "diff": "..." }` 을 돌려줍니다.
2. KsNote 는 DB 파일 변경을 감지해 상단에 **MCP 쓰기 요청 N건** 배너를 띄웁니다.
3. 배너를 열면 요청별로 도구·대상 노트·시각과 함께 diff 가 줄 단위(빨강 `-` / 초록 `+`)로 보입니다.
4. **승인하고 적용** 을 누르면 적용 직전 내용이 `revisions` 에 스냅샷으로 남고 나서 변경이 반영됩니다.
   따라서 MCP 가 만든 변경은 언제나 **설정 > 데이터 > 변경 이력** 에서 되돌릴 수 있습니다.
5. **거절** 하면 큐 항목만 `rejected` 로 닫히고 노트는 그대로입니다.

### expected_revision 과 충돌

`note_patch` · `history_restore` 는 `expected_revision` 을 요구합니다.
`history_list` 의 `currentRevision`(이력이 없으면 `0`)을 그대로 넘기면 되고,
그 사이 사용자가 노트를 고쳤다면 큐에 넣지 않고 충돌을 돌려줍니다.

```json
{
  "code": "revision_conflict",
  "expectedRevision": 3,
  "currentRevision": 5,
  "hint": "note_get 으로 최신 내용을 다시 읽고 history_list 의 currentRevision 으로 재시도하세요."
}
```

UI 와 Codex 가 동시에 편집해도 서로 덮어쓰지 않는 이유는 세 가지입니다.
쓰기 전 `expected_revision` 검사, 모든 쓰기를 감싸는 파일 락(`ksnote.db.lock`),
그리고 승인 시점에 상태 JSON 을 다시 읽고 적용하는 순서입니다.

## 5. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| Codex 가 서버를 못 띄움 | `node mcp/ksnote-server.mjs --describe` 를 직접 실행해 JSON 이 나오는지 확인 (node 18+ 필요) |
| 도구 목록이 비어 있음 | `~/.codex/config.toml` 의 `args` 경로가 실제 파일을 가리키는지 확인 |
| 노트가 하나도 안 보임 | `--db` 경로가 KsNote 가 쓰는 파일인지 확인 (설정 > MCP 연결 카드의 "저장소" 줄) |
| 쓰기가 반영되지 않음 | 정상 동작입니다. KsNote 배너에서 승인해야 반영됩니다 |
| 저장소가 사용 중이라는 오류 | 다른 프로세스가 `ksnote.db.lock` 을 10초 이상 잡고 있는 경우입니다. 앱을 재시작하면 stale 락이 회수됩니다 |
| 원인을 알 수 없음 | 로그 파일 확인: `<userData>/logs/mcp-server.log` (JSON Lines, 설정 > MCP 연결 > 오류 로그에서도 마지막 100줄을 볼 수 있음) |

서버는 **stdout 으로 JSON-RPC 만** 내보내고 로그는 stderr + 로그 파일로만 씁니다.
stdout 에 다른 출력을 섞으면 클라이언트가 프로토콜 오류를 냅니다.

## 6. MVP 3 완료 기준 대응

| 완료 기준 | 구현 |
| --- | --- |
| Codex 에서 현재 노트와 선택 영역을 읽을 수 있다 | 앱이 현재 노트·선택 영역을 `meta.current_context` 에 게시하고 `workspace_get_context` 가 이를 돌려준다 |
| 프로젝트 전체 노트를 검색할 수 있다 | `note_search`(score·snippet·projectId 필터) + `project_list` + `note_get` 의 blockRange/heading 범위 읽기 |
| 쓰기 작업은 revision 과 사용자 승인을 요구한다 | 쓰기 도구 5종이 `pending_writes` 에만 적재되고, `note_patch`·`history_restore` 는 `expected_revision` 을 검사한다 |
| UI 와 Codex 가 동시에 편집해도 자동 덮어쓰지 않는다 | 파일 락 + 외부 변경 감지 후 reload + revision 충돌 응답, 승인 시점 재적용 |
| 모든 MCP 변경을 history 에서 복구할 수 있다 | 승인 적용 직전 이전 내용을 `revisions` 에 스냅샷하고 `history_list`·`history_restore` 로 되돌릴 수 있다 |
