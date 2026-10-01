# KsNote 아키텍처 및 주요 동작 흐름

작성일: 2026-09-28 (2026-10-01 라벨·Flow 표 보강)

## 읽는 법

- 대상 독자: 이 저장소를 처음 만지는 개발자와 AI 에이전트. 사용자용 안내는
  [README](../README.md) (시나리오 `UC-*`, Flow `F-*`)를 먼저 본다.
- 라벨 체계 (전 문서 공통): `UC-영역-번호` 사용자 시나리오,
  `F-영역-번호` Flow 다이어그램 ID, `S1…` 단계 번호,
  `R1…` 관계 번호(§1), `CR-*` 코드 리뷰 항목.
  Flow 표의 코드·테스트 컬럼으로 라벨→코드→테스트를 추적한다.
- 이 문서는 저장소의 실제 진입점과 모듈 경계를 기준으로, 글로만 설명하기
  어려운 구조와 실행 흐름을 Mermaid 다이어그램으로 정리한다. 다이어그램의 컴포넌트
  이름은 소스의 주요 파일·심볼 이름을 유지했으며, 직접 호출 또는 IPC 계약이 확인된
  관계만 실선으로 표현했다.

## 1. 시스템 컨텍스트

KsNote는 Electron 메인 프로세스, React/TipTap 렌더러, 로컬 SQLite 저장소, 선택적
Codex App Server와 STDIO MCP 서버로 구성된 로컬 우선 노트 앱이다.

```mermaid
flowchart LR
    User(["사용자"])
    subgraph KS["KsNote 데스크톱 앱"]
        Renderer["React 렌더러<br/>src/main.jsx · RichDocumentEditor"]
        Main["Electron 메인 프로세스<br/>electron/main.cjs"]
        DB[("SQLite snapshot<br/>노트·revision·asset")]
        MCP["KsNote MCP Server<br/>mcp/ksnote-server.mjs"]
    end
    Codex["Codex CLI / App Server"]
    Rovo["외부 MCP<br/>Atlassian Rovo 등"]

    User -->|"편집·승인·내보내기"| Renderer
    Renderer <-->|"contextBridge IPC"| Main
    Main -->|"storage-load/save<br/>revision·asset"| DB
    Codex -->|"STDIO tools/list·call"| MCP
    MCP -->|"동일 DB 읽기·작업 큐 기록"| DB
    Main <-->|"JSON-RPC app-server<br/>AI·Rovo 조사"| Codex
    Codex -->|"승인된 외부 도구 호출"| Rovo
```

근거:

- 렌더러 진입점은 `src/main.jsx:createRoot(...)`이고, 문서 편집은
  `src/RichDocumentEditor.jsx:RichDocumentEditor`가 담당한다.
- 메인 프로세스는 `electron/main.cjs`에서 `BrowserWindow`, `ipcMain`, SQLite
  snapshot, Codex App Server client를 소유한다.
- 렌더러에 노출되는 저장·AI·MCP API는 `electron/preload.cjs`의
  `contextBridge.exposeInMainWorld(...)`에 정의되어 있다.
- 외부 Codex가 사용하는 로컬 서버는 `mcp/ksnote-server.mjs`의
  `StdioServerTransport`다.

관계 Flow 표 (다이어그램 화살표와 `R1…` 순서가 일치한다):

| 관계 | 흐름 | 코드 | 설명 |
|---|---|---|---|
| R1 | 편집·승인·내보내기 | `src/main.jsx`, `src/RichDocumentEditor.jsx` | 사용자가 직접 만지는 유일한 면이다. `UC-EDIT-01`, `UC-AI-01` 참고 ([README](../README.md)) |
| R2 | contextBridge IPC | `electron/preload.cjs` (`exposeInMainWorld`) | 렌더러는 Node/Electron API를 직접 호출하지 않는다. IPC 채널 추가 시 preload·main·UI 세 곳을 함께 변경한다 |
| R3 | storage-load/save | `electron/main.cjs` + `electron/atomic-write.cjs` | [F-EDIT-01](../README.md) S2~S4. 직렬화·원자 교체·revision 확정 |
| R4 | STDIO tools/list·call | `mcp/ksnote-server.mjs` (`StdioServerTransport`) | Codex가 타는 진입점. [F-MCP-01](../README.md) S1~S3 |
| R5 | 동일 DB 읽기·작업 큐 기록 | `mcp/ksnote-server.mjs` + SQLite snapshot | UI와 MCP가 같은 DB를 본다. 쓰기는 큐를 거쳐 앱 승인이 있어야 반영된다 |
| R6 | JSON-RPC app-server | `electron/codex-app-server-client.cjs` | AI 실행·Rovo 조사의 통로. [F-AI-01](../README.md), [F-PUB-01](../README.md) |
| R7 | 승인된 외부 도구 호출 | `electron/atlassian-rovo-service.cjs` | Codex 호스트의 Rovo 도구를 빌려 쓴다. KsNote가 직접 Atlassian API를 들고 있지 않다 |

## 2. 내부 컴포넌트와 의존 방향

```mermaid
flowchart TB
    subgraph UI["UI / Workflow Layer"]
        App["App<br/>src/main.jsx"]
        Editor["RichDocumentEditor<br/>TipTap·블록 UI·AI 패널"]
        Settings["설정·프로젝트·페이지 UI<br/>src/main.jsx"]
    end
    subgraph BRIDGE["Process Boundary Layer"]
        Preload["preload.cjs<br/>contextBridge API"]
        Main["main.cjs<br/>IPC handler·window·AI 실행"]
        CodexClient["codex-app-server-client.cjs<br/>JSON-RPC session"]
    end
    subgraph DOMAIN["Document / Integration Layer"]
        Content["editor-content.mjs<br/>block·callout·diagram 구조"]
        Validation["diagram-validation.mjs<br/>Mermaid/PlantUML 입력 검증"]
        Target["target-ref.mjs<br/>page/block/offset/revision"]
        TaskIndex["task-index.mjs<br/>build/query/isFresh"]
        McpServer["ksnote-server.mjs<br/>read/write tools·operation queue"]
    end
    subgraph STORAGE["Persistence Layer"]
        SQLite[("sql.js SQLite DB")]
        Atomic["atomic-write.cjs<br/>serialized snapshot"]
        Assets[("userData/assets")]
        History[("revision / AI turn history")]
    end
    App --> Editor
    App --> Settings
    Editor -->|"window.ksnoteStorage / ksnoteMcp / ksnoteAI"| Preload
    Settings --> Preload
    Preload -->|"IPC invoke / event"| Main
    Main --> CodexClient
    Main --> Atomic
    Main --> SQLite
    Main --> Assets
    Main --> History
    McpServer --> Target
    McpServer --> Validation
    McpServer --> TaskIndex
    McpServer --> SQLite
    McpServer --> Atomic
    Editor --> Content
    Editor --> Validation
```

### 컴포넌트 책임

| 컴포넌트 | 책임 | 확인 위치 |
|---|---|---|
| `App` / `Settings` | 프로젝트·페이지 선택, 설정, 자동 저장 상태, 승인 UI | `src/main.jsx` |
| `RichDocumentEditor` | TipTap 문서 편집, Mermaid/PlantUML/draw.io 블록, AI 대상 범위 | `src/RichDocumentEditor.jsx` |
| `preload.cjs` | 렌더러와 메인 사이의 허용된 API만 노출 | `electron/preload.cjs` |
| `main.cjs` | IPC, SQLite 초기화, asset/revision 저장, AI 프로세스 수명 관리 | `electron/main.cjs` |
| `ksnote-server.mjs` | Codex용 읽기/쓰기 MCP tool, revision 충돌·작업 큐 | `mcp/ksnote-server.mjs` |
| `task-index.mjs` | task 목록 materialized index 빌드·조회·freshness (`task-index.json`, Electron이 저장 시 갱신) | `mcp/task-index.mjs` |
| `editor-content.mjs` / `diagram-validation.mjs` | 문서 블록 구조와 다이어그램 입력 검증 | `src/`, `mcp/` |

## 3. 일반 편집과 자동 저장 흐름

```mermaid
sequenceDiagram
    actor U as 사용자
    participant E as RichDocumentEditor
    participant P as preload.cjs
    participant M as electron/main.cjs
    participant W as atomic-write.cjs
    participant DB as SQLite
    U->>E: 텍스트·표·블록 편집
    E->>E: TipTap transaction
    E->>P: ksnoteStorage.save(snapshot)
    P->>M: IPC storage-save
    M->>W: 직렬화된 snapshot 기록 요청
    W->>DB: 임시 파일 교체 방식으로 저장
    DB-->>M: revision / 저장 완료
    M-->>P: 성공 응답
    P-->>E: 저장 상태 갱신
```

`electron/atomic-write.cjs:createSerializedFileWriter`가 동시 저장 요청을 직렬화하고,
`main.cjs`가 DB snapshot 및 revision 이력을 관리한다. 렌더러는 DB 파일을 직접 열지
않고 preload IPC만 사용한다.

사용자 시나리오와 단계별 추적은 [F-EDIT-01](../README.md) (`UC-EDIT-01`)을 본다.
위 시퀀스의 메시지는 F-EDIT-01의 S1~S5와 1:1로 대응한다
(E→E transaction = S1, `ksnoteStorage.save` = S2, 직렬화·원자 교체 = S3,
revision 확정 = S4, 저장 상태 갱신 = S5).

## 4. Mermaid Smart Paste와 렌더링 흐름 (F-DIAG-01)

시나리오 `UC-DIAG-01` (붙여넣기로 흐름도 넣기): 사용자가 Mermaid 코드펜스를
복사해 본문에 붙여넣는다. 확인 UI에서 변환을 고르면 전용 블록이 생기고,
소스를 고칠 때마다 미리보기가 따라온다.

```mermaid
flowchart LR
    Clipboard["클립보드 입력"] --> Detect["RichDocumentEditor<br/>paste handler"]
    Detect -->|"Mermaid fence 정규화"| Normalize["normalizeMermaidPaste"]
    Normalize --> Validate["validateDiagramSource"]
    Validate -->|"유효"| Block["mermaidBlock node<br/>뒤에 editable paragraph"]
    Validate -->|"오류"| Text["일반 텍스트 / 오류 안내"]
    Block --> Cache["createMermaidRenderCache<br/>200~300ms debounce"]
    Cache --> SVG["Mermaid SVG"]
    SVG --> EditorPreview["블록 내부 Preview"]
    SVG --> SplitPreview["오른쪽 분할 Preview"]
    Cache -.->|"동일 code면 재사용"| EditorPreview
```

핵심 구현은 `src/RichDocumentEditor.jsx`의 `normalizeMermaidPaste`,
`validateDiagramSource`, `sharedMermaidRenders`와 `src/mermaid-render-cache.mjs`다.
같은 Mermaid source는 code key로 pending/cached 결과를 공유하며, 붙여넣은 블록에는
커서가 이동할 수 있는 후행 문단을 함께 만든다.

Flow 표 (다이어그램 노드 순서와 `S1…`가 일치한다):

| 단계 | 흐름 | 코드 | 테스트 | 설명 |
|---|---|---|---|---|
| S1 | 클립보드 입력 감지 | `src/RichDocumentEditor.jsx` (paste handler, `confirmAsync` 확인 UI) | `editor-source-regressions` "Mermaid paste" | Mermaid fence·PlantUML·표·코드를 감지하고 적용 전 확인 UI를 띄운다 |
| S2 | Mermaid fence 정규화 | `normalizeMermaidPaste` | `diagram-validation.test.mjs` | 코드펜스·언어 태그 변형을 표준 source로 정리한다 |
| S3 | 선언 기본 검증 | `validateDiagramSource` (`mcp/diagram-validation.mjs`) | `diagram-validation.test.mjs` | 빈 다이어그램·펜스·미닫힘을 거부한다. 실패하면 일반 텍스트/오류 안내로 폴백 |
| S4 | 전용 블록 + 후행 문단 | `editableDiagramWithTrailingParagraph("mermaidBlock")` | `editor-source-regressions` "trailing editable paragraph" | 블록 뒤에 커서가 갈 수 있는 편집 문단을 함께 만든다. PlantUML·draw.io도 같은 함수로 커서 점프를 막는다 |
| S5 | 렌더 캐시 (200~300ms debounce) | `sharedMermaidRenders`, `src/mermaid-render-cache.mjs` | `mermaid-render-cache.test.mjs` | 동일 code는 pending/cached 결과를 공유해 중복 렌더를 없앤다 |
| S6 | SVG → 블록 Preview + 분할 Preview | 블록 내부 Preview, 오른쪽 분할 Preview | E2E (`scripts/verify-diagram-e2e.mjs`) | 두 프리뷰가 같은 SVG를 소비한다. 렌더 실패는 블록에 오류로 표시된다 |

## 5. Codex MCP 다이어그램 삽입 흐름

시나리오 `UC-MCP-01`의 내부 구현 관점이다. 사용자용 설명과 단계 추적은
[F-MCP-01](../README.md)을 본다. 아래 시퀀스는 같은 흐름을 IPC·프로세스
수준에서 펼친 것으로, S-번호는 F-MCP-01과 공유한다.

```mermaid
sequenceDiagram
    actor U as 사용자
    participant C as Codex
    participant S as ksnote-server.mjs
    participant Q as operation queue
    participant E as KsNote 렌더러
    participant M as Electron main
    participant DB as SQLite
    U->>C: targetRef와 다이어그램 작성 요청
    C->>S: note_get(targetRef)
    S-->>C: page/block context + revision
    C->>S: diagram_insert(expectedRevision, format, code)
    S->>S: target/revision/diagram source 검증
    S->>Q: pending operation atomic write
    S-->>C: operationId
    E->>M: heartbeat / pending poll
    M-->>E: 승인 대기 작업
    U->>E: 승인
    E->>M: mcp-operation-approve
    M->>Q: applying 상태 기록
    M->>E: block 삽입·렌더 검증
    E->>M: mcp-operation-complete
    M->>DB: snapshot + revision 저장
    C->>S: operation_get(operationId)
    S-->>C: completed 또는 구조화된 error
```

`targetRef`는 `mcp/target-ref.mjs`가 해석하며 `block/offset`을 우선 앵커로 사용하고,
`expectedRevision`이 현재 revision과 다르면 자동 덮어쓰기를 차단한다. 쓰기 tool은
`mcp/write-approval.mjs`의 승인 정책과 `mcp/ksnote-server.mjs`의 TTL 작업 큐를
통과해야 한다.

IPC 단계 대응 (F-MCP-01의 S-번호와 일치):

| 단계 | 시퀀스 메시지 | IPC·코드 | 설명 |
|---|---|---|---|
| S4 | heartbeat / pending poll, 승인 대기 작업 | `mcp-operation-list`, heartbeat | 렌더러는 창이 가려져도 polling을 유지한다. `applying`은 만료 처리된다 |
| S5 | `mcp-operation-approve` → `applying` 기록 | `electron/main.cjs` (`mcp-operation-approve`), `mcp/write-approval.mjs` | `pending → approved → applying` 전이는 메인 프로세스가 소유한다 |
| S6 | block 삽입·렌더 검증 → `mcp-operation-complete` → SQLite 저장 | `src/main.jsx` + `src/RichDocumentEditor.jsx`, `data-render-status="verified"` | 완료는 SQLite 저장 확인 뒤에 반환된다. Codex는 `operation_get`으로 폴링한다 |

## 6. 관찰된 설계 특성

- **로컬 우선 저장**: UI와 MCP가 모두 동일한 SQLite와 asset 경로를 사용한다.
- **프로세스 경계 보안**: renderer는 Node/Electron API를 직접 호출하지 않고 preload가
  명시한 IPC만 사용한다.
- **명시적 타깃 편집**: 페이지·블록·offset·revision을 함께 전달해 현재 커서가
  바뀌어도 다른 위치에 쓰지 않도록 한다.
- **렌더링 결과 공유**: Mermaid source를 키로 편집 블록과 분할 프리뷰가 같은 SVG
  결과를 소비한다.
- **승인 가능한 쓰기**: MCP 쓰기는 pending → applying → completed/error/expired
  상태로 추적되고, 사용자 승인이 없으면 노트 DB에 반영되지 않는다.

## 7. 유지보수 시 주의점

1. `RichDocumentEditor`에서 selection 또는 revision을 새로 저장할 때는
   `targetRef`와 AI patch의 충돌 검사 경로를 함께 확인한다.
2. Mermaid 블록을 추가할 때는 source 정규화, 렌더 캐시, 후행 편집 문단, 분할
   프리뷰가 동일한 노드를 기준으로 동작하는지 확인한다.
3. IPC 채널을 추가하면 `preload.cjs`, `main.cjs`, 호출 UI의 세 지점을 함께 변경하고
   `tests/`의 source-regression 테스트를 추가한다.
4. MCP 쓰기 계약을 변경할 때는 `expectedRevision`, 승인, operation TTL, 완료 후
   SQLite 검증을 생략하지 않는다.
