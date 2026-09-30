# 코드 리뷰 후속 작업 리스트

- 작성일: 2026-09-30
- 대상: 병합 `65cd052..60f331b` 리뷰 결과
- 완료된 1차 수정: `303ca73` "Harden MCP write approval, IPC validation, and diagram parsing"
  (승인 유형 누락, RichPreview XSS, ReDoS, errorCode 폴백, URIError, setContent v3 API,
  DrawIoView 소스 검증, IME ArrowRight, command/model 검증, isDestroyed 가드,
  이미지 경로 격리 + 매직바이트, 잘린 JSON, 엔티티 디코딩 순서, quoted-attr 파서, `.openchrome/` 추적 제거)

체크박스를 완료 시 표시하고 커밋에 함께 반영한다.

2026-09-30 합동 리뷰 보완: 비동기 프로세스 트리 종료로 전체 8초 예산 적용,
진행 중 파일과 충돌하지 않도록 1시간 경과 임시파일만 정리,
정상 코드 구간과 미닫힘 백틱이 섞인 표 행 보존, 이미지 업로드 후 destroyed 가드,
draw.io iframe CSP 허용 및 개발 서버 내비게이션 origin 정확 비교.

## P0 — 데이터 손실 / 작동 불가

- [x] **외부 콘텐츠 동기화** — `restoreRevision`, `importMarkdownFile` 후 에디터가 예전 내용 유지 →
      다음 키입력이 복원본을 조용히 되돌림. effect가 `noteId`만 감시 → `contentSignature` prop 비교 방식 필요
      (`src/main.jsx` ↔ `src/RichDocumentEditor.jsx`)
      → `contentSignature` prop + `lastEmittedHtml` ref로 외부 변경만 재동기화, 자기 입력은 건너뜀
- [x] **HTTP 모드 동시 요청 충돌** — 요청마다 `McpServer`를 재사용해 "Already connected" throw →
      요청마다 새 인스턴스 생성 (`mcp/ksnote-server.mjs` handleMcp)
      → `createServer()`/`registerTools()` 분리, 요청마다 새 인스턴스 (동시 5건 스모크 통과)
- [x] **`expectedRevision` 선택적 우회** — 생략 시 큐/적용 양쪽 다 revision 검증 없음 →
      쓰기 도구에 필수화 또는 큐 시점 거부 (`mcp/revision.mjs` + 도구 스키마)
      → 6개 쓰기 도구 스키마 `z.string()` 필수화 + 적용 시점 `expected_revision_required` 거부
- [x] **`text_insert` 이중 의미** — 열린 노트에선 HTML로 파싱, 백그라운드에선 단순 텍스트 이스케이프 →
      한쪽으로 통일 (`src/RichDocumentEditor.jsx` insertContentAt, `src/main.jsx` 배경 적용 경로)
      → `editor-content.mjs`의 `escapePlainText`/`plainTextToParagraphHtml`로 양쪽 평문 통일

## P1 — 보안 / 안정성

- [x] **codex 앱서버 좀비 프로세스** — 종료 시 cmd wrapper만 kill →
      `taskkill /T /F` 트리킬 + `before-quit`에서 await 후 종료
      (`electron/main.cjs` + `electron/codex-app-server-client.cjs`)
      → 전역 `child.kill()` 5곳을 `killProcessTree`로 교체, `before-quit`에서
      `aiProcesses` 전량 트리킬 + `codexAppServer.stop()` 8초 bounded await
- [x] **PlantUML jarPath + asset-save 확장자** — 악성 jar 저장 후 렌더 체인 차단:
      asset-save는 이미지 확장자 화이트리스트, jar 경로는 사용자 다이얼로그 선택만 허용
      (`electron/main.cjs` asset-save, resolvePlantUmlJarPath)
      → main 측 검증은 기존 충족 확인, 설정 UI 자유 텍스트 입력을
      readOnly + 찾아보기(`plantuml-pick-jar`) 버튼으로 교체
- [x] **CSP + 창 보호** — 빌드된 `index.html`에 CSP meta 추가,
      `setWindowOpenHandler` deny, `will-navigate` 차단 (`electron/main.cjs` createWindow)
      → CSP/deny/내비게이션 차단은 기존 충족 확인(dist 포함), 추가로
      권한 요청 전면 거부 + `file://` 허용을 dist 경로로 축소 + webview 부착 거부
- [x] **시크릿 파일 원자적 쓰기** — `writeFileAtomic` + 직렬화 라이터 미사용,
      크래시 시 저장된 공급자 API키 전체 유실 (`electron/model-providers.cjs` writeSecrets)
      → 직렬화+fsync 원자 쓰기는 기존 충족 확인, 시작 시 `.tmp` 스윕을
      heartbeat/target/task-index/secrets/operations 디렉터리로 확대
- [x] **적용 원본 HTML의 DB 저장** — 렌더 시점 차단은 완료됐지만 적용 시점에도 sanitize
      (`src/main.jsx` note_create 적용 경로)
      → `sanitizeAppliedHtml` 적용은 기존 충족 확인, 백그라운드 블록 HTML의
      `blockId`/`mcpOperationId`에도 `escapeAttribute` 적용
- [x] **MCP 라우팅 effect 경쟁** — stale closure로 신규 편집 덮어쓰기, 매 렌더 1초 인터벌 재구독,
      try/catch 없어 적용 중 `applying` 갇힘 (`src/main.jsx` routePendingOperation)
      → 마운트 1회 + ref 스냅샷 + in-flight 가드 + catch→error-complete 기존 충족 확인

## P2 — 정확성 결함

- [x] **history_list 정렬 전 잘림** — readdir 순서로 200개 컷 → 최신 operation 유실,
      `history_restore` 스냅샷 해상 붕괴 → 정렬 후 limit 적용
      (`mcp/ksnote-server.mjs` listNoteOperations)
- [x] **`applying` 상태 영구 갇힘** — 앱 크래시 시 디스크에서 만료 안 됨,
      operation_get와 상태 분기 → `mcp-operation-list`에 applying 만료 추가
      (`electron/main.cjs` + `mcp/ksnote-server.mjs`)
- [x] **이미지 블록 `running` 상태 재로드 후 갇힘** — parseHTML에서 `queued` 복귀
      또는 `idle` 리셋 처리 (`src/RichDocumentEditor.jsx` imageGenerationBlock)
- [x] **runTurn 타임아웃 미중단** — 타임아웃이 실제 turn을 interrupt 안 함 +
      interrupt()가 첫 60초 no-op; 동시 호출 시 context 스레드 중복 생성
      (`electron/codex-app-server-client.cjs` runTurn/getOrCreateThread)
- [x] **DrawIoView settleOperation 언마운트 후 계속 실행** — destroyedRef로 조기 종료 +
      operation error 완료 처리 (`src/RichDocumentEditor.jsx`)
- [x] **스마트 표 붙여넣기가 `text/html` 무시** — 리치 표 원문 붙여넣기 불가,
      표 분기에 `!/<table[\s>]/i` 조건 추가 (`src/RichDocumentEditor.jsx`)
- [x] **export-adf 중첩 리스트 평탄화 + 체크박스 상태 드랍** — 재귀 변환 +
      taskItem 상태 출력 (`src/atlassian/export-adf.mjs` parseListItems)
- [x] **PlantUML/draw.io 삽입 커서 점프** — mermaid에 적용한
      `editableDiagramWithTrailingParagraph`를 나머지 형식에도 확장
      (`src/RichDocumentEditor.jsx` `/plantuml`, `/draw_edit` 등)
- [x] **image-generate 전용 스크래치 cwd** — 현재 Documents 전체가
      workspace-write + approvalPolicy never → `userData/ai-scratch`로 격리
      (`electron/main.cjs` getCodexAppServer / image-generate)

## P3 — 소소한 결함

- [x] operation ID에 `crypto.randomUUID()` 사용 (동일 밀리초 충돌 방지)
      → `ksnote-server` 큐는 기존 적용 확인, 잔여 `imggen-` 2곳
      (`electron/main.cjs`, `RichDocumentEditor.jsx`)을 randomUUID 우선으로 교체
- [x] `maxAttempts` → `maxRetries` 명명 정리 (문서 "2회 더" 의미와 정렬)
      → 정식 `maxRetries` + `maxAttempts` 별칭 유지 + AGENTS.md 문서화 + 테스트 기존 충족 확인
- [x] HTTP 인증 토큰 `crypto.timingSafeEqual` 상수시간 비교 + allowedHosts 미설정 경고
      (`mcp/ksnote-server.mjs`) → 기존 충족 확인
- [x] atomic-write fsync 후 rename + 시작 시 `.tmp` 스윕 (`electron/atomic-write.cjs`)
      → fsync/sweep 기존 충족 + P1에서 스윕 범위 확대 확인
- [x] PDF export `printWindow` try/finally (`electron/main.cjs`) → 기존 충족 확인
- [x] `ai-session-compaction-error` preload에 노출 (`electron/preload.cjs`)
      → `onCompactionError` 기존 노출 확인
- [x] Ctrl+N 구현 또는 힌트 제거 (`src/main.jsx`) → Ctrl/Command+N 새 노트 구현 확인
- [x] 파일 붙여넣기 stale position clamp (`RichDocumentEditor.jsx` readFileBlock)
      → `safePos` clamp + destroyed 가드 기존 충족 확인
- [x] `confirmAsync` 큐잉 — 두 번째 확인이 첫 대기자 버림 (`RichDocumentEditor.jsx`)
      → `confirmQueueRef` 대기열 기존 충족 확인
- [x] markdown-table-paste 파서의 짝 안 맞는 백틱 처리 (`src/markdown-table-paste.mjs`)
      → 미닫힘 백틱 시 일반 문자 폴백 기존 충족 확인
- [x] ResizableImageView `pointercancel` 정리 (`RichDocumentEditor.jsx`) → 기존 충족 확인
- [x] flushDatabase 실패 시 `writeRuntimeLog` 기록 (`electron/main.cjs`) → 기존 충족 확인
