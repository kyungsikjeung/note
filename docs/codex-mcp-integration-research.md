# KsNote × Codex MCP 연동 조사 및 100개 사용 시나리오

작성일: 2026-07-15

## 1. 결론

KsNote는 **로컬 STDIO MCP 서버**를 제공하고 Codex가 그 서버를 실행하도록 구성하는 방식이 가장 적합하다. 다만 현재 노트 데이터가 Electron 렌더러의 `localStorage`에만 있으므로 MCP 프로세스가 직접 접근할 수 없다. 먼저 노트 저장소를 SQLite 또는 파일 기반 저장소로 옮기고, 에디터와 MCP 서버가 같은 Repository 계층을 사용해야 한다.

권장 흐름은 다음과 같다.

```text
사용자 → Codex → KsNote MCP Server(STDIO)
                         ↓
                  KsNote Repository
                SQLite + Assets + History
                         ↓
                Electron 편집기 자동 갱신
```

초기 버전에서는 외부에 포트를 열지 않는 STDIO가 단순하고 안전하다. 이후 모바일이나 원격 접근이 필요할 때만 OAuth가 적용된 Streamable HTTP 서버를 추가한다.

## 2. 공식 문서에서 확인한 사항

- Codex 로컬 클라이언트는 STDIO와 Streamable HTTP MCP 서버를 지원한다.
- Codex CLI, IDE 확장, ChatGPT 데스크톱 앱은 같은 Codex 호스트의 MCP 설정을 공유한다.
- 전역 설정은 `~/.codex/config.toml`, 프로젝트 전용 설정은 신뢰된 저장소의 `.codex/config.toml`에 둘 수 있다.
- 서버 초기화 응답의 `instructions`는 서버 전체 사용법과 제약을 설명한다. Codex 문서는 중요한 안내를 첫 512자 안에 독립적으로 이해할 수 있게 작성하라고 권장한다.
- 각 Tool은 고유한 `name`, 사용자용 `title`, 모델이 선택에 사용하는 `description`, JSON Schema 기반 `inputSchema`를 제공한다. 선택적으로 `outputSchema`와 위험 힌트를 제공할 수 있다.
- `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`는 보안 계약이 아니라 힌트다. 실제 권한 제한과 승인 절차는 서버와 호스트에서 강제해야 한다.
- Codex에서는 서버 전체 또는 도구별 승인 모드를 `auto`, `prompt`, `writes`, `approve`로 설정할 수 있다.

참고:

- [OpenAI Codex MCP 안내](https://learn.chatgpt.com/docs/extend/mcp)
- [MCP Tools 명세](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP 구조와 Tool Discovery](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP 보안 원칙](https://modelcontextprotocol.io/specification/2025-03-26)

## 3. 권장 Codex 설정

프로젝트 전용 `.codex/config.toml` 예시:

```toml
[mcp_servers.ksnote]
command = "node"
args = ["./mcp/ksnote-server.mjs"]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
required = false
default_tools_approval_mode = "writes"

enabled_tools = [
  "workspace_get_context",
  "project_list",
  "note_search",
  "note_get",
  "note_create",
  "note_patch",
  "note_move",
  "task_query",
  "task_update",
  "asset_get",
  "history_list",
  "history_restore"
]

[mcp_servers.ksnote.tools.note_search]
approval_mode = "approve"

[mcp_servers.ksnote.tools.note_get]
approval_mode = "approve"

[mcp_servers.ksnote.tools.note_patch]
approval_mode = "prompt"

[mcp_servers.ksnote.tools.history_restore]
approval_mode = "prompt"
```

CLI 등록 예시는 다음과 같다.

```powershell
codex mcp add ksnote -- node ./mcp/ksnote-server.mjs
codex mcp list
```

## 4. 서버 Instructions 초안

첫 512자 안에 들어갈 핵심 지침:

> KsNote는 사용자의 로컬 프로젝트 노트 저장소다. 답변에 노트 내용이 필요하면 먼저 note_search 후 note_get을 사용한다. 쓰기 전에 대상 noteId와 revision을 확인하고, note_patch에는 최소 범위 patch와 예상 revision을 전달한다. 사용자가 명시하지 않은 프로젝트나 노트를 삭제하지 않는다. 원본 전체 교체보다 block 단위 수정을 우선한다. 충돌 시 덮어쓰지 말고 최신 revision과 diff를 반환한다.

추가 지침:

- 제목만 보고 내용을 추측하지 않는다.
- 검색 결과가 여러 개면 점수와 프로젝트를 비교한 후 읽는다.
- 읽기 도구를 먼저 사용하고 쓰기는 가능한 최소 범위로 수행한다.
- AI가 만든 내용에는 `source: codex`, 실행 시각, 사용자 지시를 history metadata로 남긴다.
- 삭제는 기본 도구 세트에서 제외하고 휴지통 이동을 별도 승인 도구로 둔다.
- 이미지 바이너리를 문맥에 전부 넣지 않고 메타데이터·OCR·썸네일 리소스를 사용한다.

## 5. Tool Description 설계 원칙

좋은 Description은 단순 기능 설명이 아니라 **언제 사용하고, 언제 사용하지 않으며, 선행 조건과 부작용이 무엇인지**를 알려야 한다.

권장 문장 구조:

```text
[무엇을 한다]. [언제 사용한다]. [먼저/대신 사용할 도구].
[부작용과 승인 조건]. [중요 입력값과 결과].
```

예시:

```text
Search notes by title, body text, project, tags, block type, and updated time.
Use this before note_get when the exact noteId is unknown. This tool is read-only
and returns ranked summaries, not full note bodies. Do not use it to infer content
that is absent from snippets.
```

피해야 할 Description:

- `노트를 검색합니다.`처럼 선택 기준이 없는 문장
- 읽기와 쓰기를 한 도구에 혼합한 `manage_note`
- `알아서 적절히 처리`처럼 결과가 불명확한 표현
- 승인·삭제·전체 교체 여부를 숨기는 표현
- 유사 도구와 구분되지 않는 이름과 설명

## 6. MVP 권장 Tool 목록과 Description

### `workspace_get_context`

현재 KsNote 작업 공간, 활성 프로젝트, 열린 노트, 선택 영역과 revision을 읽는다. 사용자가 “여기”, “이 노트”, “선택한 부분”이라고 말했을 때 먼저 사용한다. 읽기 전용이며 노트 전체 본문은 반환하지 않는다.

### `project_list`

프로젝트 ID, 이름, 노트 수와 최근 수정 시각을 나열한다. 프로젝트 이름이 모호하거나 사용자가 전체 작업 공간을 언급할 때 사용한다. 읽기 전용이다.

### `note_search`

제목, 본문, 프로젝트, 태그, 블록 유형, 수정 시각으로 노트를 검색한다. 정확한 noteId를 모를 때 `note_get`보다 먼저 사용한다. 순위화된 스니펫만 반환하며 검색 결과에 없는 내용을 추측하면 안 된다.

### `note_get`

하나의 noteId에서 요청한 범위의 구조화된 블록과 revision을 읽는다. 검색으로 대상을 식별한 뒤 사용한다. `scope`로 전체, 특정 blockId, heading 아래 또는 줄 범위를 제한해 불필요한 문맥 로드를 피한다.

### `note_create`

지정 프로젝트에 새 노트를 생성한다. 사용자가 새 노트나 별도 산출물을 명시했을 때 사용한다. 기존 노트 수정에는 사용하지 않는다. 쓰기 작업이며 생성된 noteId와 revision을 반환한다.

### `note_patch`

기존 노트의 최소 범위를 구조화된 patch로 수정한다. 먼저 `note_get`으로 noteId, blockId, revision을 확인해야 한다. 전체 문서 교체보다 insert/update/delete block을 우선하며 revision 충돌 시 쓰지 않고 diff를 반환한다.

### `note_move`

노트를 다른 프로젝트로 이동하거나 프로젝트 내 순서를 변경한다. 본문은 변경하지 않는다. 사용자가 이동 대상을 명시했을 때만 사용하며 쓰기 승인이 필요하다.

### `task_query`

Task List 블록의 할 일을 프로젝트, 완료 상태, 날짜, 담당자 기준으로 조회한다. 일반 문단의 추정 TODO는 반환하지 않는다. 읽기 전용이다.

### `task_update`

기존 taskId의 완료 상태, 본문, 날짜 또는 담당자를 수정하거나 지정 블록에 새 task를 추가한다. 대상 노트와 revision을 먼저 확인한다. 쓰기 승인이 필요하다.

### `asset_get`

이미지·GIF·첨부파일의 메타데이터, OCR 텍스트 또는 제한된 미리보기를 읽는다. 원본 바이너리는 명시적으로 요청된 경우에만 반환한다. 읽기 전용이다.

### `history_list`

노트 변경 이력, 작성 주체, 지시문과 revision diff 요약을 나열한다. 복구 전 대상 revision을 찾을 때 사용한다. 읽기 전용이다.

### `history_restore`

노트를 선택한 과거 revision으로 복구하되 현재 상태를 새 revision으로 먼저 보존한다. 파괴 가능성이 있는 쓰기 작업이므로 항상 사용자 승인을 요구한다.

## 7. Description 기반 접근 시나리오 100개

아래의 “선택 이유”는 Codex가 Tool Description을 읽고 어떤 도구를 고르는지를 나타낸다.

### A. 작업 공간과 검색

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 1 | 지금 열어 둔 노트 요약해줘 | `workspace_get_context → note_get` | “이 노트”를 활성 noteId로 해석한 뒤 본문을 읽고 채팅으로 요약한다. |
| 2 | 선택한 문단을 쉽게 설명해줘 | `workspace_get_context → note_get` | 선택 영역 block/range만 읽어 불필요한 전체 노트 로드를 피한다. |
| 3 | Unity 관련 노트 찾아줘 | `note_search` | noteId가 없으므로 검색을 먼저 사용하고 순위화된 결과를 제시한다. |
| 4 | Timeline 줌 버그 노트 열어봐 | `note_search → note_get` | 제목이 유사한 후보를 찾은 뒤 정확한 한 노트를 읽는다. |
| 5 | 어제 수정한 노트가 뭐지? | `note_search(updatedAfter)` | 본문이 아니라 수정 시각 필터가 필요한 읽기 요청이다. |
| 6 | Mermaid가 들어간 문서 찾아줘 | `note_search(blockType=mermaid)` | 블록 유형 검색 기능을 사용한다. |
| 7 | 체크하지 않은 할 일 전부 보여줘 | `task_query(completed=false)` | 일반 텍스트 검색 대신 실제 Task List만 조회한다. |
| 8 | 프로젝트 목록 보여줘 | `project_list` | 노트 검색 없이 프로젝트 메타데이터만 반환한다. |
| 9 | AI 작업 공간에 노트 몇 개 있어? | `project_list` | 프로젝트별 noteCount로 답한다. |
| 10 | 최근 작업하던 프로젝트가 뭐야? | `project_list` | 최근 수정 시각 기준으로 프로젝트를 비교한다. |
| 11 | MCP라는 단어가 들어간 문단 찾아줘 | `note_search(query=MCP)` | 스니펫과 noteId를 반환하고 내용을 추측하지 않는다. |
| 12 | 표가 많은 노트 찾아줘 | `note_search(blockType=table)` | 구조화 블록 인덱스를 사용한다. |
| 13 | 이 제목과 비슷한 노트가 또 있어? | `workspace_get_context → note_search` | 현재 제목을 얻은 뒤 유사 제목 검색을 수행한다. |
| 14 | 삭제된 노트 말고 현재 노트만 검색해줘 | `note_search(includeTrash=false)` | 기본 활성 저장소 범위만 검색한다. |
| 15 | 정확히 어떤 노트인지 모르겠는데 ESP32 회의 내용 | `note_search → 후보 제시` | 모호할 때 임의로 하나를 수정하지 않고 후보를 보여준다. |

### B. 읽기와 질의응답

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 16 | 이 문서의 핵심 결정은? | `workspace_get_context → note_get(scope=full)` | 현재 노트 본문을 읽고 결정 사항만 답한다. |
| 17 | 요구사항 섹션만 읽어줘 | `note_get(scope=heading)` | heading 아래 범위만 가져온다. |
| 18 | 표의 상태 열만 분석해줘 | `note_get(scope=blockId)` | 표 블록만 읽어 분석한다. |
| 19 | 코드 블록에서 버그 후보 찾아줘 | `note_get(scope=codeBlock)` | 코드 블록만 읽고 노트는 변경하지 않는다. |
| 20 | Mermaid 흐름 설명해줘 | `note_get(scope=mermaidBlock)` | 저장된 Mermaid source를 읽고 설명한다. |
| 21 | 첨부 이미지에 적힌 오류가 뭐야? | `asset_get(mode=ocr)` | 이미지 원본 대신 OCR 텍스트를 우선 사용한다. |
| 22 | 이 GIF 파일 크기와 형식 알려줘 | `asset_get(mode=metadata)` | 바이너리 없이 메타데이터만 읽는다. |
| 23 | 지난 회의와 오늘 회의 차이 비교 | `note_search → note_get ×2` | 두 대상을 검색하고 각각 읽어 비교한다. |
| 24 | 이 프로젝트에서 반복되는 이슈는? | `note_search(projectId) → note_get(selected)` | 검색 스니펫으로 후보를 좁힌 뒤 필요한 노트만 읽는다. |
| 25 | 완료된 할 일 비율은? | `task_query(projectId)` | task의 실제 checked 상태로 계산한다. |
| 26 | 누가 이 문단을 마지막으로 바꿨어? | `workspace_get_context → history_list` | 본문 검색이 아니라 revision metadata를 조회한다. |
| 27 | Codex가 바꾼 부분만 보여줘 | `history_list(source=codex)` | 변경 주체 필터를 사용한다. |
| 28 | 지난 버전과 지금 버전 차이는? | `history_list(diff=true)` | 수정하지 않고 revision diff를 반환한다. |
| 29 | 이 노트에 연결된 파일 목록 | `note_get(scope=assets)` | 노트의 asset 참조만 읽는다. |
| 30 | 긴 문서 전체 말고 목차만 알려줘 | `note_get(scope=outline)` | heading outline만 반환해 토큰 사용을 줄인다. |

### C. 노트와 프로젝트 생성

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 31 | Unity 프로젝트에 새 회의 노트 만들어줘 | `project_list → note_create` | 프로젝트 ID를 확인하고 별도 노트를 생성한다. |
| 32 | 오늘 날짜로 데일리 노트 생성 | `note_create(template=daily)` | 새 산출물이 명시됐으므로 create를 사용한다. |
| 33 | 이 내용을 별도 노트로 보관해줘 | `workspace_get_context → note_create` | 현재 선택 내용을 원본과 분리해 새 노트에 저장한다. |
| 34 | 조사 결과용 빈 노트 하나 만들어줘 | `note_create` | 기존 노트를 건드리지 않고 빈 구조를 생성한다. |
| 35 | 회의 템플릿으로 노트 만들어줘 | `note_create(template=meeting)` | 결정/할 일/참석자 블록이 포함된 템플릿을 사용한다. |
| 36 | 버그 리포트 템플릿 생성 | `note_create(template=bug)` | 재현/예상/실제/로그 섹션을 만든다. |
| 37 | 현재 노트를 복제해서 실험본 만들어줘 | `note_get → note_create` | 원본을 수정하지 않고 복사본 noteId를 만든다. |
| 38 | Mermaid 예제만 있는 새 노트 | `note_create(blocks=[mermaid])` | 구조화 Mermaid 블록으로 생성한다. |
| 39 | 할 일만 관리할 노트 생성 | `note_create(blocks=[taskList])` | 실제 Task List 블록을 포함한다. |
| 40 | 프로젝트 README 노트 생성 | `note_search(title=README) → note_create` | 중복 여부를 먼저 확인한다. |
| 41 | 이미 있으면 만들지 말고 찾아줘 | `note_search → 조건부 note_create` | 검색 결과가 있으면 생성하지 않는다. |
| 42 | 선택 문단으로 FAQ 노트 생성 | `workspace_get_context → note_get → note_create` | 선택 범위만 원천 자료로 사용한다. |
| 43 | 이번 주 보고서 초안 노트 생성 | `task_query + note_search → note_create` | 기존 상태를 읽어 새 보고서를 만든다. |
| 44 | 코드 리뷰 결과를 별도 노트로 저장 | `note_create` | 채팅 답변이 아니라 사용자가 저장을 명시했으므로 생성한다. |
| 45 | 같은 프로젝트에 영문 복사본 생성 | `note_get → note_create` | 원본 revision을 유지하며 번역본을 별도 생성한다. |

### D. 최소 범위 편집과 변환

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 46 | 선택 문단을 3줄로 요약해서 교체 | `context → note_get → note_patch` | 선택 block/range에만 replace patch를 적용한다. |
| 47 | 이 문단 아래에 요약 추가 | `context → note_patch(insertAfter)` | 기존 문단을 보존하고 새 블록을 삽입한다. |
| 48 | 문서 맨 위에 개요 넣어줘 | `note_get(outline) → note_patch(insertBefore)` | 전체 교체 없이 첫 블록 앞에 추가한다. |
| 49 | 맞춤법만 고쳐줘 | `note_get → note_patch` | 서식과 블록 ID를 보존하는 텍스트 patch를 사용한다. |
| 50 | 존댓말로 바꿔줘 | `note_get(scope=selection) → note_patch` | 선택 영역만 다시 쓴다. |
| 51 | 영어로 번역해줘 | `note_get(scope=selection) → note_patch` | 사용자가 현재 노트 변경을 원하므로 patch한다. |
| 52 | 이 목록을 표로 바꿔줘 | `note_get(block) → note_patch(replaceBlock=table)` | 문단 문자열이 아니라 Table block으로 변환한다. |
| 53 | 표를 글머리 목록으로 바꿔줘 | `note_get(table) → note_patch(replaceBlock=list)` | 표 데이터 보존 여부를 diff preview로 보여준다. |
| 54 | 긴 문단을 섹션 세 개로 나눠줘 | `note_get(block) → note_patch(splitBlocks)` | 한 블록을 headings+paragraphs로 분할한다. |
| 55 | 제목 레벨을 한 단계 내려줘 | `note_get(outline) → note_patch(attributes)` | 텍스트가 아닌 heading attribute만 변경한다. |
| 56 | 중요한 문장을 노란색 표시 | `context → note_patch(mark=highlight)` | 선택 범위에 inline mark만 추가한다. |
| 57 | 이 문장을 굵게 만들어줘 | `context → note_patch(mark=bold)` | 선택 텍스트를 보존하며 서식만 바꾼다. |
| 58 | 코드 블록 언어를 TypeScript로 변경 | `note_get(codeBlock) → note_patch(attributes)` | 코드 내용은 그대로 두고 language 속성만 변경한다. |
| 59 | JSON 코드 정렬해줘 | `note_get(codeBlock) → note_patch(content)` | 해당 JSON 블록만 포맷한다. |
| 60 | 중복 문단 제거 | `note_get → note_patch(deleteBlocks)` | 삭제될 blockId를 명시하고 승인 후 적용한다. |
| 61 | 결론 섹션을 맨 아래로 이동 | `note_get(outline) → note_patch(moveBlock)` | 본문 재생성 없이 블록 순서만 변경한다. |
| 62 | 이 노트 제목 바꿔줘 | `context → note_patch(metadata.title)` | 본문이 아니라 제목 metadata만 수정한다. |
| 63 | 태그 세 개 추가 | `context → note_patch(metadata.tags)` | 기존 태그를 보존하고 additive patch를 적용한다. |
| 64 | AI가 쓴 문단에 출처 표시 | `history_list → note_patch` | Codex 변경 block을 확인한 뒤 출처 metadata를 추가한다. |
| 65 | 전체를 덮어쓰지 말고 변경점만 적용 | `note_get(revision) → note_patch(operations)` | Description의 최소 patch 원칙과 revision 검사를 따른다. |

### E. 체크리스트와 업무

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 66 | 이 회의에서 할 일을 체크리스트로 추가 | `note_get → note_patch(insert taskList)` | 추출한 항목을 실제 Task List 블록으로 삽입한다. |
| 67 | 첫 번째 할 일 완료 처리 | `context → task_query → task_update` | 표시 순서와 taskId를 확인하고 checked=true로 수정한다. |
| 68 | 미완료 항목만 오늘 섹션으로 복사 | `task_query → note_patch` | 원 task는 유지하고 새 목록을 추가한다. |
| 69 | 완료된 항목은 숨겨줘 | `task_query → note_patch(attributes)` | 삭제하지 않고 표시 설정을 변경한다. |
| 70 | 이 할 일에 내일 날짜 추가 | `task_query → task_update(dueDate)` | 실제 taskId의 날짜 metadata를 수정한다. |
| 71 | 긴 문장을 세 개 할 일로 분리 | `task_query/get → task_update + inserts` | 기존 task를 최소 수정하고 두 task를 추가한다. |
| 72 | 중복 할 일 합쳐줘 | `task_query → task_update` | 완료 상태와 원문을 비교하고 승인 후 병합한다. |
| 73 | 프로젝트별 미완료 개수 알려줘 | `project_list → task_query` | 읽기만 수행하고 노트는 수정하지 않는다. |
| 74 | 완료 항목을 주간 보고서에 추가 | `task_query → note_search → note_patch` | 완료 task를 찾고 기존 보고서에 새 섹션으로 추가한다. |
| 75 | 체크리스트를 일반 목록으로 바꿔줘 | `note_get(taskList) → note_patch` | checked 상태 손실을 경고하고 승인 후 변환한다. |

### F. 표·코드·다이어그램·미디어

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 76 | 이 데이터를 4열 표로 정리 | `context → note_patch(replaceBlock=table)` | 편집 가능한 Table block을 생성한다. |
| 77 | 표에 상태 열 추가 | `note_get(table) → note_patch(table operation)` | table 전체 HTML 교체 대신 column operation을 사용한다. |
| 78 | 상태가 완료인 행 배경색 변경 | `note_get(table) → note_patch(cell attributes)` | 조건에 맞는 셀 속성만 수정한다. |
| 79 | 표 헤더를 가운데 정렬 | `note_get(table) → note_patch(header align)` | header cells에만 정렬 속성을 적용한다. |
| 80 | 이 설명을 Mermaid 순서도로 추가 | `context → note_patch(insert mermaidBlock)` | 코드펜스가 아니라 KsNote Mermaid block을 삽입한다. |
| 81 | Mermaid 노드 이름을 한글로 변경 | `note_get(mermaid) → note_patch(code)` | 해당 source만 수정하고 재렌더링은 앱이 수행한다. |
| 82 | 흐름도를 시퀀스 다이어그램으로 변환 | `note_get(mermaid) → note_patch(code)` | 동일 blockId에서 Mermaid 타입 source를 변경한다. |
| 83 | 문법 오류 난 Mermaid 고쳐줘 | `note_get(mermaid) → note_patch(code)` | 오류 블록만 수정하고 preview 결과를 앱이 검증한다. |
| 84 | PlantUML로 바꿔줘 | `note_get → 지원 확인` | PlantUML runtime이 없으면 쓰지 않고 미지원 상태와 설정 방법을 안내한다. |
| 85 | 코드 예제 아래에 설명 추가 | `note_get(codeBlock) → note_patch(insertAfter)` | 코드 내용은 보존한다. |
| 86 | 붙인 이미지를 50% 크기로 변경 | `context → note_patch(image width)` | asset 파일을 변경하지 않고 image block attribute만 수정한다. |
| 87 | 이미지 OCR 결과를 캡션으로 넣어줘 | `asset_get(ocr) → note_patch(image caption)` | OCR을 읽은 뒤 같은 이미지 블록에 캡션을 추가한다. |
| 88 | 큰 GIF를 찾아 목록으로 알려줘 | `note_search(blockType=image) → asset_get(metadata)` | 파일을 수정하거나 압축하지 않고 크기만 보고한다. |

### G. 프로젝트·이동·이력

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 89 | 이 노트를 Unity 프로젝트로 이동 | `context → project_list → note_move` | 대상 projectId를 확인하고 본문 없이 이동만 수행한다. |
| 90 | 프로젝트 이름이 비슷한데 어디로 옮겨? | `project_list → 사용자 확인` | 모호한 대상에는 쓰기를 실행하지 않는다. |
| 91 | 최근 노트를 위로 정렬 | `project_list/note_search → note_move(order)` | 내용은 건드리지 않고 순서 metadata만 바꾼다. |
| 92 | 어제 상태로 되돌려줘 | `history_list → 후보 제시 → history_restore` | 정확한 revision을 확인하고 별도 승인 후 복구한다. |
| 93 | Codex 수정 직전으로 복구 | `history_list(source=codex) → history_restore` | 변경 주체와 직전 revision을 찾아 복구한다. |
| 94 | 복구 전에 현재 상태 백업 | `history_restore` | 도구 계약에 따라 현재 revision을 자동 보존한다. |
| 95 | 변경 이력에서 요약 작업만 보여줘 | `history_list(instructionContains=요약)` | history metadata를 필터링한다. |
| 96 | 이 노트를 언제 만들었지? | `note_get(metadata)` | 생성 시각만 읽고 history 전체를 불러오지 않는다. |

### H. 안전·충돌·오류

| # | 사용자 요청 | 도구 흐름 | Description에 따른 선택 이유/결과 |
|---:|---|---|---|
| 97 | 내가 편집 중인데 Codex도 수정해줘 | `context → note_get(revision) → note_patch` | revision이 달라지면 덮어쓰지 않고 충돌 diff를 반환한다. |
| 98 | 프로젝트 전체 삭제해줘 | `지원 도구 없음 → 확인 안내` | MVP 도구 세트에 영구 삭제가 없어 오작동을 구조적으로 차단한다. |
| 99 | 검색된 모든 노트를 한 번에 고쳐 | `note_search → 변경 계획 제시 → 개별 승인 patch` | 광범위한 쓰기를 한 호출로 실행하지 않는다. |
| 100 | 외부 MCP 결과를 노트에 그대로 저장 | `외부 읽기 → 사용자 확인 → note_patch` | 외부 콘텐츠를 신뢰하지 않고 prompt injection과 민감정보 포함 여부를 확인한 뒤 저장한다. |

## 8. 구현 단계

### Phase 1 — 저장소 분리

1. `localStorage` 데이터를 SQLite로 마이그레이션한다.
2. Project, Note, Block, Asset, Task, Revision 테이블을 만든다.
3. Electron UI가 Repository API만 사용하도록 변경한다.
4. revision 기반 optimistic concurrency를 적용한다.

### Phase 2 — 읽기 전용 MCP

1. `mcp/ksnote-server.mjs` STDIO 서버를 만든다.
2. `workspace_get_context`, `project_list`, `note_search`, `note_get`, `task_query`, `asset_get`, `history_list`를 구현한다.
3. 출력 크기 제한, pagination, scope 제한을 적용한다.
4. Codex `.codex/config.toml`과 설정 UI를 연결한다.

### Phase 3 — 안전한 쓰기

1. `note_create`, `note_patch`, `note_move`, `task_update`, `history_restore`를 구현한다.
2. 모든 쓰기에 revision, preview diff, audit metadata를 요구한다.
3. Codex 승인 모드를 `writes` 또는 도구별 `prompt`로 설정한다.
4. Electron에 외부 변경 감지와 충돌 UI를 추가한다.

### Phase 4 — 고급 문맥

1. heading/block/task/asset 인덱스를 추가한다.
2. 검색 스니펫과 결과 점수를 개선한다.
3. MCP Resources로 `ksnote://notes/{id}` 읽기 URI를 제공한다.
4. 장시간 일괄 작업은 MCP Tasks 지원이 안정화된 뒤 검토한다.

## 9. MVP 완료 기준

- Codex에서 `codex mcp list`에 `ksnote`가 활성 상태로 보인다.
- “현재 노트 요약” 요청이 활성 noteId를 찾아 읽는다.
- “Unity 노트 검색”이 1초 내 순위화된 결과를 반환한다.
- 쓰기 전 diff와 대상 note/revision이 표시된다.
- UI와 MCP가 동시에 수정하면 자동 덮어쓰기 대신 충돌을 반환한다.
- 모든 AI 수정은 revision history에서 원복할 수 있다.
- 영구 삭제와 광범위 일괄 변경은 기본적으로 차단된다.
