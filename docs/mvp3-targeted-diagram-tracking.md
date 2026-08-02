# MVP 3.1 — Codex 타깃 다이어그램 삽입 추적

업데이트: 2026-08-02

## 목표

사용자가 KsNote 페이지 ID 또는 현재 클릭 위치 타깃을 복사해 Codex에 전달하면,
Codex가 코드 변경점이나 사용자의 설명을 분석하고 Mermaid, PlantUML, draw.io 중
적합한 형식을 선택해 명시된 노트 위치에 전용 다이어그램 블록으로 삽입한다.

`업로드`는 MVP에서 외부 클라우드 전송이 아니라 로컬 KsNote SQLite 노트에
다이어그램 매크로를 저장하는 것을 의미한다.

## 사용자 시나리오

```text
현재 코드 변경점을 아래 KsNote 타깃에 다이어그램으로 정리해줘.

KsNote target: ksnote://page/n1?block=<blockId>&offset=7&revision=<revision>&operation=insert
적합한 형식은 자동 선택하고 대상 노트에 삽입해줘.
```

예상 도구 흐름:

```text
코드 변경점 조사
→ note_get(targetRef)
→ diagram_capabilities
→ 다이어그램 소스 생성
→ diagram_insert(expectedRevision)
→ operation_get
→ completed 또는 구조화된 오류 보고
```

## 타깃 계약

### 페이지만 지정

```text
ksnote://page/<pageId>
```

- 현재 커서를 상속하지 않는다.
- 기본 작업은 대상 페이지 끝에 `append`다.

### 클릭 또는 선택 위치 지정

```text
ksnote://page/<pageId>?block=<blockId>&offset=<offset>&toBlock=<blockId>&toOffset=<offset>&from=<fallback>&to=<fallback>&revision=<revision>&operation=<operation>
```

- `block/offset`이 실제 삽입 위치의 우선 앵커다.
- `from/to`는 이전 버전과 호환하기 위한 fallback이다.
- `revision`이 다르면 자동 덮어쓰지 않는다.
- 명시적 `targetRef`가 현재 열린 페이지와 라이브 커서보다 항상 우선한다.

## 형식 자동 선택

| 형식 | 권장 용도 | 준비 조건 |
| --- | --- | --- |
| Mermaid | 코드 구조, 흐름도, 시퀀스, 상태, ERD | 앱 내장 |
| PlantUML | 클래스, 컴포넌트, 복잡한 UML 시퀀스 | 번들 JAR + 로컬 Java 런타임 |
| draw.io | 수동 배치, 발표용, 후속 시각 편집 | diagrams.net 네트워크 |

사용자가 형식을 지정하면 그 선택이 자동 규칙보다 우선한다.

## 구현 추적

### P0 — 안정적인 타깃

- [x] 페이지별 고유 ID 복사
- [x] 페이지 전용 참조와 클릭 타깃 참조 분리
- [x] 명시적 targetRef가 라이브 커서보다 우선
- [x] TipTap 블록에 안정적인 `data-block-id` 저장
- [x] block/offset과 from/to fallback을 함께 복사
- [x] 복사 시 revision 및 operation 포함
- [x] 기존 단순 `ksnote://page/<pageId>?from=&to=` 호환
- [ ] workspaceId를 포함한 다중 작업공간 주소

### P1 — Codex 및 포맷 선택

- [x] `diagram_capabilities` MCP Tool
- [x] Mermaid/PlantUML/draw.io 권장 용도 Tool instructions 반영
- [x] 현재 앱 heartbeat에 렌더러 준비 상태 포함
- [x] 창이 가려지거나 최소화돼도 MCP heartbeat/polling 유지
- [x] 사용자가 명시한 형식 우선
- [x] Codex가 최종 format을 선택해 `diagram_insert` 호출
- [ ] KsNote AI 패널에 `자동` 형식 선택 UI

### P2 — 적용 및 라우팅

- [x] MCP `note_create`로 대상 페이지 생성
- [x] revision optimistic concurrency
- [x] operation queue atomic write
- [x] pending/applying/completed/error/expired 추적
- [x] 현재 페이지에 TipTap 전용 블록 삽입
- [x] 다른 페이지 작업을 감지해 대상 페이지로 자동 이동
- [x] 대상 페이지가 preview이면 edit 모드로 전환
- [x] draw.io 블록 도구 모음에 `Editor / XML / Preview` 전환 추가
- [x] `Preview`는 diagrams.net 편집 UI 없이 최신 저장 XML의 읽기 전용 SVG 렌더를 표시
- [x] `Editor ↔ XML ↔ Preview` 전환 후에도 iframe을 유지해 다중 페이지 XML, 현재 페이지, 선택 상태를 보존
- [x] XML 또는 Editor 저장 직후 Preview를 다시 렌더하고 실패하면 이전 정상 Preview와 오류를 함께 표시
- [x] Preview 더블클릭·확대 버튼으로 원본과 분리된 전체화면 SVG 뷰어 표시
- [x] 전체화면 `축소 / 현재 배율 / 확대 / 100% / 화면 맞춤` 컨트롤
- [x] 25~400% 휠 확대·축소, 확대 상태 드래그 이동, `Esc` 종료
- [x] 마지막 배율은 다이어그램 속성이 아닌 renderer 세션 메모리에서만 공유
- [ ] 화면 전환 없는 백그라운드 노트 적용
- [x] 적용 직전 실제 다이어그램 미리보기와 메인 프로세스 소유 `pending → approved → applying` 승인 정책

### P3 — 검증 및 복구

- [x] 빈 다이어그램과 Markdown 코드 펜스 거부
- [x] Mermaid 선언 기본 검증
- [x] PlantUML 시작/종료 기본 검증
- [x] draw.io mxfile/mxGraphModel 기본 검증
- [x] 적용 실패를 operation error로 기록
- [x] Mermaid 실제 parser/SVG 렌더 검증 결과를 MCP에 반환
- [x] PlantUML Java SVG 렌더 결과 검증 후 삽입
- [x] draw.io XML parser 및 vertex/edge endpoint 구조 검증
- [x] draw.io embed load 후 SVG export 검증
- [x] `data-mcp-operation-id`와 `data-render-status="verified"` 저장
- [x] 정확한 block ID 기반 `replace-block`
- [x] 정확한 block ID 기반 `diagram_delete`
- [x] 완료 operation 원본으로 다이어그램 복구 스크립트 제공
- [x] 문서 정제/재시작 후 다이어그램 `data-code` 보존
- [ ] 실패 시 Codex 1~2회 자동 수정 재시도 계약
- [x] 완료 토스트의 편집기 history 기반 즉시 되돌리기 액션
- [ ] 완료 토스트의 대상 이동·소스 보기 액션

## 테스트 및 완료 기준

- [x] target reference round-trip 단위 테스트
- [x] MCP 도구 목록에 `diagram_capabilities`가 노출된다.
- [x] 페이지 ID만 전달하면 대상 페이지 끝에 삽입된다.
- [ ] 클릭 타깃을 전달하면 해당 block/offset에 삽입된다.
- [x] 편집 후 revision이 달라지면 `revision_conflict`가 반환된다.
- [x] 다른 페이지 타깃이면 해당 페이지로 이동해 삽입된다.
- [x] 세 포맷 모두 operation이 `completed`와 `renderVerified=true`로 종료된다.
- [x] 패키지 `KsNote.exe`의 외부 MCP STDIO transport E2E를 통과한다.

### 2026-08-02 draw.io 전체화면 확대 회귀

- 자동 회귀: `npm run test:mvp` 23/23 통과
- 프로덕션 빌드: Vite build 통과
- 소스 Electron E2E: 전체화면, 버튼 125%, 휠 140%, 드래그 이동, `Esc` 종료 통과
- 세션 상태: 닫고 다시 연 뒤 140% 배율 유지 확인
- 비파괴성: 뷰어 조작 전후 SQLite content와 revision 불변 확인
- 영향도 분석: 최초 시험에서 뷰어 조작이 아니라 `renderStatus=pending → verified`의 지연 저장을 검출
- 수정: verified 속성과 draw.io XML을 같은 persistence barrier에서 저장한 뒤 operation `completed` 반환
- 패키지 E2E: 최신 `app.asar`에서도 동일 시나리오와 기존 승인·Undo 회귀 통과
- 최종 패키지: `release-mvp32-manual-20260802/win-unpacked/KsNote.exe`

### 2026-08-02 MVP 3.2 승인·Preview·Undo 회귀

- 자동 회귀: `npm run test:mvp` 22/22 통과
- 빌드: Vite production build 통과
- 승인 전: `diagram_insert`는 `awaiting_approval`이며 SQLite 내용·revision 불변
- 승인 UI: Mermaid/draw.io 실제 렌더 미리보기와 원본 소스, page/block/operation 표시
- 승인 상태: operation 파일은 메인 프로세스가 `pending → approved → applying → completed/error`로 전이
- 저장 장벽: 최초 라이브 시험에서 `completed`가 SQLite debounce보다 먼저 기록되는 결함을 검출하고, 저장 완료 뒤 `completed`를 반환하도록 수정
- 복구: 완료 토스트 Undo가 해당 TipTap editor history를 실행하며 SQLite revision 복구 확인
- draw.io: 승인 미리보기, Editor/XML/Preview 전환, 블록 Preview SVG, 실제 export 검증 통과
- 패키지 E2E: 패키지 내부 `resources/app.asar/mcp/ksnote-server.mjs` transport로 동일 시나리오 통과
- 표준 패키징: electron-builder가 Electron 임시 폴더 rename에서 Windows `EPERM`을 반복해, 기존 검증 Electron 런타임 복사본의 `app.asar`를 최신 빌드로 재조립했다.
- 최종 패키지: `release-mvp32-manual-20260802/win-unpacked/KsNote.exe`

### 2026-08-02 개발 앱 MCP E2E

- 앱 heartbeat: `open=true`, Mermaid/draw.io 사용 가능 확인
- 페이지 생성 operation: `mcp-1785601882433-35712c6916ec2` → `completed`
- 생성 페이지: `n-1785601882919-77b17cc3a5e71` (`MCP연동 시퀀스 다이어그램`)
- Mermaid 삽입 operation: `mcp-1785602326742-b1a38874ff45` → `completed`
- SQLite 저장 revision: `rf03d36cf`
- 검증 범위: 개발 앱 + 실제 로컬 MCP STDIO + operation queue + SQLite 저장
- 후속 검증에서 Mermaid flowchart/sequence, PlantUML component, draw.io connected architecture 실제 렌더와 SQLite 저장을 통과했다.

### 2026-08-02 실제 렌더·저장 E2E

- 대상 페이지: `n-1785601882919-77b17cc3a5e71` (`MCP연동 시퀀스 다이어그램`)
- Mermaid code architecture: `mcp-1785603938448-e24f53d859f5b` → SVG 26,167 bytes
- Mermaid sequence: `mcp-1785603940766-8d60c1fe20154` → SVG 31,832 bytes
- PlantUML component: `mcp-1785603942878-d4deedc0491fa` → SVG 6,106 bytes
- draw.io architecture: `mcp-1785603954290-be0869e8dae0a` → SVG 17,310 bytes, vertex 5개, edge 4개
- 잘못된 Mermaid는 `diagram_render_failed`로 저장 없이 실패했다.
- endpoint가 없는 draw.io edge는 `drawio_edge_endpoint_missing`으로 queue 전에 거부됐다.
- stale revision은 `revision_conflict`로 거부됐다.
- 빈 레거시 블록 삭제: `mcp-1785604744102-c523ec9a5c2fc` → `completed`
- 완료 operation 원본 복구:
  - flowchart `mcp-1785605195330-a16611cb1c17a`
  - sequence `mcp-1785605208660-8513432fce6fd`
  - PlantUML `mcp-1785605216864-cd87ac89932f5`
- 앱 재시작 후 저장 revision `r18b36d5d`, verified 다이어그램 4개, 빈 verified 소스 0개 확인
- 실행 앱 접근성 트리에서 flowchart, sequence, PlantUML SVG, draw.io editor를 모두 확인했고 raw parse 오류는 없었다.

### 2026-08-02 패키지 MCP transport E2E

- 검증 페이지: `n-1785626640285-8d15f80d863608` (`패키지 MCP 다이어그램 검증 2026-08-02`)
- transport: `KsNote.exe` + `ELECTRON_RUN_AS_NODE=1` + `resources/app.asar/mcp/ksnote-server.mjs`
- Mermaid code architecture: `mcp-1785627455292-7d2b6d8c748288` → SVG 26,284 bytes
- Mermaid sequence: `mcp-1785627458950-8cab7c69bbbc8` → SVG 31,845 bytes
- PlantUML component: `mcp-1785627460304-a3c34535d39978` → SVG 6,106 bytes
- draw.io architecture: `mcp-1785627465144-3a6cc1f218b8c` → SVG 15,070 bytes, vertex 5개, edge 4개
- 잘못된 Mermaid: `mcp-1785627469706-e5bad64cf0255` → `diagram_render_failed`, revision 불변
- endpoint 없는 draw.io edge는 `drawio_edge_endpoint_missing`, stale revision은 `revision_conflict`로 거부됐다.
- 패키지 흰 화면의 원인이 Vite 절대 asset 경로로 확인되어 `base: "./"`로 수정했다.
- SQLite 전체 export와 operation JSON은 임시 파일 원자 교체로 저장하며 Windows `EPERM/EBUSY`는 제한 재시도한다.
- 패키지 앱 재시작 후 heartbeat PID와 Mermaid/PlantUML/draw.io capability가 모두 정상임을 확인했다.

## 관련 공식 계약

- [Codex MCP](https://developers.openai.com/codex/mcp/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
