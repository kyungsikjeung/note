# KsNote

KsNote는 문서 작성, 표, 코드, 이미지, 다이어그램, 체크리스트와 AI 편집을 한 화면에서 다루는 로컬 우선 데스크톱 작업 공간입니다.

제품의 핵심 방향은 다음과 같습니다.

> 사용자는 형식과 문법을 외우지 않고 기록하며, 에디터와 AI가 내용을 이해하고 안전한 변경 단위로 편집한다.

이 문서는 프로그램 소개이면서, 다음 개발 세션에서 AI에게 그대로 전달할 수 있는 기능 요구사항과 MVP 체크리스트입니다.

## 상태 표시 규칙

- `[x]` 현재 소스에 구현되어 빌드 가능한 기능
- `[ ]` 아직 구현되지 않았거나 UI만 있고 실제 동작 연결이 필요한 기능
- 기능이 일부만 구현된 경우 구현된 부분과 남은 부분을 별도 항목으로 분리

## 실행 방법

요구 환경:

- Node.js
- npm
- Windows 우선 지원
- AI 기능 사용 시 로그인된 Codex CLI 또는 Claude Code CLI

```powershell
npm install
npm run dev
```

개발 모드에서는 Vite가 렌더러를 갱신하고, `electron/main.cjs` 또는
`electron/preload.cjs`가 변경되면 Electron 프로세스도 자동으로 재시작됩니다.
따라서 IPC 채널을 추가하거나 변경해도 오래된 메인 프로세스가 남지 않습니다.

프로덕션 빌드:

```powershell
npm run build
npm run desktop
```

## 현재 기술 구성

- Electron
- React
- Vite
- TipTap/ProseMirror
- Mermaid
- Highlight.js
- 로컬 CLI 기반 Codex/Claude 실행
- 현재 데이터 저장소: SQLite + 로컬 assets (`localStorage`는 호환 백업)

---

# MVP 1 — Smart Editor

목표: AI가 없어도 문서, 표, 코드, 이미지, 다이어그램과 할 일을 편하게 작성할 수 있는 로컬 데스크톱 노트 에디터를 완성한다.

## 1. 작업 공간과 프로젝트

- [x] 앱 이름을 `KsNote`로 표시
- [x] 프로젝트 목록 표시
- [x] 프로젝트 추가
- [x] 프로젝트 이름 변경
- [x] 프로젝트 삭제
- [x] 프로젝트 삭제 시 포함된 노트 cascade 삭제
- [x] 삭제 전 프로젝트 이름과 삭제되는 노트 수 표시
- [x] 프로젝트별 노트 필터링
- [x] 새 노트 생성
- [x] 현재 프로젝트에서 페이지 추가
- [x] 프로젝트 `…` 메뉴에서 해당 프로젝트에 페이지 추가
- [x] 노트 제목 직접 편집
- [x] 노트 검색
- [x] 최근 수정 시각 표시
- [x] 자동 저장 상태 표시
- [x] 사이드바 열기/닫기
- [x] 노트 이름 변경과 별도의 노트 삭제 메뉴
- [x] 노트 휴지통과 복원
- [x] 프로젝트 및 노트 드래그 정렬
- [x] 하위 노트 트리와 하위 페이지 추가

## 2. WYSIWYG 문서 편집기

- [x] TipTap 기반 실제 문서 편집
- [x] 일반 문단
- [x] 제목 1, 제목 2
- [x] 굵게, 기울임, 밑줄, 취소선
- [x] 글자색
- [x] 배경 강조색
- [x] 왼쪽, 가운데, 오른쪽 정렬
- [x] 글머리 목록
- [x] 번호 목록
- [x] 인용문
- [x] 구분선
- [x] Undo/Redo
- [x] 선택 영역이 툴바 클릭으로 사라지지 않도록 selection 복원
- [x] 코드 블록 마지막에서 `→` 키로 일반 문단으로 빠져나오기
- [x] 편집/분할/보기 모드
- [x] 분할 모드에서 실시간 HTML 프리뷰
- [x] 제목 3~6
- [x] 링크 삽입·수정 UI
- [x] 글꼴 크기와 글꼴 종류를 실제 Rich Editor에 적용
- [x] 찾기/바꾸기
- [x] 문서 목차
- [x] 블록 드래그 이동

## 3. Slash Command

빈 문단에서 `/`를 입력하면 현재 커서 주변에 블록 명령 메뉴를 표시해야 합니다.

- [x] `/` 입력 시 명령 목록 표시
- [x] 키워드 검색
- [x] 위/아래 방향키로 이동
- [x] Enter로 선택
- [x] Esc로 닫기
- [x] 마우스로 선택
- [x] `/table` 표 삽입
- [x] `/code` 코드 블록 삽입
- [x] `/file` 이미지/GIF 파일 선택창
- [x] `/diagram` 다이어그램 종류 선택
- [x] `/mermaid` Mermaid 블록 바로 삽입
- [x] `/plantuml` 로컬 렌더링 블록 삽입
- [x] `/draw_edit` draw.io 편집기 블록 삽입
- [x] `/draw_xml` draw.io XML 소스 블록 삽입
- [x] `/draw_mermaid` Mermaid 블록 별칭 삽입
- [x] `/check` 체크 가능한 할 일 목록
- [x] `/h1`, `/h2`
- [x] `/list`, `/number`
- [x] `/quote`, `/divider`, `/text`
- [x] 최근 사용 명령 우선 표시
- [x] 사용자 정의 Slash Command

## 4. 표 편집

표는 별도 소스 창이나 Markdown 문법이 아니라 본문 안에서 바로 보여야 하며 셀을 직접 편집할 수 있어야 합니다.

- [x] 본문 커서 위치에 실제 표 삽입
- [x] 툴바에서 8×8 크기 선택
- [x] 셀 직접 편집
- [x] 셀 범위 선택
- [x] 열 너비 드래그 조절
- [x] 위/아래 행 추가
- [x] 왼쪽/오른쪽 열 추가
- [x] 행 삭제
- [x] 열 삭제
- [x] 표 삭제
- [x] 셀 병합과 분할
- [x] 셀 배경색
- [x] `Ctrl+Alt+Right` 오른쪽 열 추가
- [x] `Ctrl+Alt+Down` 아래 행 추가
- [x] 표 전용 AI 지시 입력 UI
- [x] 표 셀 글자색 전용 UI
- [x] 셀별 좌/중/우 정렬 UI
- [x] Excel/CSV 클립보드를 Rich Table로 자동 변환
- [x] 선택 행·열 재정렬 UI
- [x] Jira/Confluence 호환 표 클립보드 내보내기

## 5. 코드 블록

- [x] `/code`로 코드 블록 생성
- [x] 본문 안에서 직접 코드 편집
- [x] 어두운 코드 전용 스타일
- [x] 코드 블록 밖으로 키보드 이동
- [x] 언어 선택 메뉴
- [x] Smart Paste 코드 유형 감지
- [x] 구문 강조
- [x] JSON 코드 자동 정렬/Beautify
- [x] 줄 번호
- [x] 코드 접기
- [x] 코드 블록 복사 버튼
- [x] 붙여 넣은 코드를 자동으로 코드 블록 변환

## 6. 이미지와 파일

- [x] 클립보드 이미지를 현재 커서 위치에 붙여 넣기
- [x] 파일 드래그 앤 드롭
- [x] `/file` 파일 선택창
- [x] PNG, JPEG, WebP, GIF 선택
- [x] 여러 이미지 선택
- [x] 이미지 좌/중/우 정렬
- [x] 25%, 50%, 75%, 100% 크기 버튼
- [x] 좌우 핸들로 이미지 크기 조절
- [x] 이미지 원본 비율 유지
- [x] 일반 첨부파일 블록
- [x] 이미지 캡션 편집
- [x] 큰 이미지 자동 압축(1.5MB 초과, GIF 제외)
- [x] 로컬 OCR(한국어/영어)
- [x] 로컬 asset 파일 저장소

## 7. Mermaid와 다이어그램

- [x] Mermaid 전용 블록
- [x] Source/Split/Preview 전환
- [x] Mermaid 소스 수정 시 즉시 렌더링
- [x] Mermaid 소스 복사
- [x] Mermaid 블록 삭제
- [x] Mermaid 문법 오류 표시
- [x] 편집 모드에서 SVG 렌더링
- [x] 오른쪽 분할 프리뷰에서 Mermaid SVG 렌더링
- [x] `/diagram` 통합 진입 화면
- [x] Mermaid 코드 Smart Paste 감지
- [x] PlantUML 로컬 Java/JAR 런타임 설정
- [x] PlantUML 블록 렌더링
- [x] Mermaid/PlantUML 기본 흐름·시퀀스 상호 변환
- [x] draw.io diagrams.net embed 편집기 블록
- [x] draw.io XML 소스 보존과 파일 저장
- [x] MCP `diagram_insert(format: "drawio")`를 draw.io 편집 블록으로 삽입
- [x] draw.io 블록에 `Editor / XML / Preview` 3단 보기 전환
- [x] draw.io `Preview`에서 편집 도구를 숨기고 저장된 XML의 읽기 전용 SVG 렌더 결과 표시
- [x] `Editor ↔ XML ↔ Preview` 전환 시 iframe을 유지해 XML·현재 페이지·선택 상태 보존
- [x] 새 Preview 실패 시 마지막 정상 SVG를 유지하고 오류·재시도 표시
- [x] draw.io Preview 더블클릭·확대 버튼으로 전체화면 뷰어 열기
- [x] 전체화면에서 25~400% 확대·축소, 100%, 화면 맞춤 제공
- [x] 마우스 휠 확대·축소와 확대 상태의 드래그 이동, `Esc` 종료
- [x] 마지막 배율은 앱 세션에서만 공유하고 XML·노트 revision은 변경하지 않음
- [x] 다이어그램을 PNG/SVG로 내보내기

## 8. 체크리스트

- [x] `/check`로 실제 Task List 생성
- [x] 체크박스 클릭으로 완료/미완료 변경
- [x] 완료 항목 취소선 표시
- [x] Enter로 다음 할 일 추가
- [x] 빈 항목에서 Enter로 목록 종료
- [x] Tab/Shift+Tab 중첩 단계 변경
- [x] 프리뷰에 체크 상태 표시
- [x] 마감일
- [x] 담당자
- [x] 우선순위
- [x] 프로젝트 전체 할 일 모아보기
- [x] 완료 항목 숨기기

## 9. Smart Paste

- [x] 클립보드 이미지 감지
- [x] Mermaid 소스 감지
- [x] 붙여 넣은 Mermaid를 전용 블록으로 변환
- [x] 코드 자동 감지 및 코드 블록 변환
- [x] JSON 감지와 Beautify
- [x] CSV/TSV/Excel 표 변환
- [x] HTML 클립보드 Rich Text 변환
- [x] Markdown 전체 구조 변환
- [x] PlantUML 감지와 블록 변환
- [x] 붙여 넣기 변환 결과를 적용 전 선택할 수 있는 확인 UI

## 10. 설정과 작업 공간 메뉴

- [x] 상단 `…` 메뉴
- [x] 하단 작업 공간 `…` 메뉴
- [x] 메뉴 밖 클릭과 Esc로 닫기
- [x] 일반 설정 탭
- [x] 편집기 설정 탭
- [x] AI Agent 설정 탭
- [x] MCP 연결 설정 탭
- [x] 데이터 설정 탭
- [x] 보안 설정 탭
- [x] 설정을 로컬에 저장
- [x] Codex/Claude 기본 Agent 선택
- [x] Agent CLI 실행 명령 설정
- [x] MCP 서버 이름, 명령, 인자, 활성 상태 설정 UI
- [x] 테마 설정 실제 적용
- [x] 편집기 글꼴 설정 실제 적용
- [x] 맞춤법 설정 실제 적용
- [x] MCP 서버 연결 테스트
- [x] Agent CLI 설치/로그인 상태 테스트
- [x] 키보드 단축키 목록 화면

## 11. 저장과 내보내기

- [x] 로컬 자동 저장
- [x] 앱 재실행 후 프로젝트와 노트 복원
- [x] Markdown 파일 저장 대화상자
- [x] Rich HTML을 Markdown으로 변환해서 내보내기
- [x] HTML 내보내기
- [x] PDF 내보내기
- [x] DOCX 내보내기
- [x] SQLite 저장소
- [x] 노트별 revision history와 복원
- [x] 첨부파일을 별도 assets 디렉터리에 저장

## MVP 1 완료 기준

- [x] 프로젝트와 노트를 생성하고 자동 저장할 수 있다.
- [x] 일반 문서, 표, 코드, 이미지, Mermaid와 체크리스트를 본문에서 편집할 수 있다.
- [x] `/` 명령으로 주요 블록을 삽입할 수 있다.
- [x] 편집/분할/보기 모드가 동작한다.
- [x] Windows 개발 빌드가 성공한다.
- [x] Smart Paste가 코드, JSON, 표, Markdown을 편집 가능한 블록으로 변환한다.
- [x] GFM Markdown 내보내기·다시 가져오기와 Mermaid/PlantUML 왕복

---

# MVP 2 — AI Editor

목표: 구독형 Codex/Claude CLI를 사용해 노트를 질문하고 최소 범위로 안전하게 편집한다.

## 0. Codex App Server 기반 구독 통합

- [x] Electron 시작 시 `codex app-server` 장기 실행
- [x] `initialize → initialized` JSON-RPC 핸드셰이크
- [x] App Server 비정상 종료 감지와 다음 요청 시 안전한 재시작
- [x] `account/read`로 ChatGPT 구독 로그인·이메일·플랜 확인
- [x] `account/login/start(type: chatgpt)` 브라우저 구독 로그인
- [x] 로그인 완료·로그아웃·계정 변경 이벤트 반영
- [x] API key 계정과 ChatGPT 구독 계정 상태 구분
- [x] `model/list` 기반 실제 사용 가능 모델 동적 표시
- [ ] 모델별 reasoning effort와 기본 모델 정보 표시
- [x] 노트·AI 세션별 `thread/start` 및 앱 재시작 후 `thread/resume`
- [x] `turn/start` 기반 AI 요청
- [x] `item/agentMessage/delta` 기반 응답 스트리밍
- [x] `turn/completed` 성공·실패 상태 처리
- [x] `turn/interrupt` 기반 실행 취소
- [x] 앱 종료 시 App Server와 대기 요청 안전하게 정리
- [ ] `codex exec`는 App Server 장애 시 명시적 fallback으로만 유지

### AI 세션과 컨텍스트 관리

- [x] 프로젝트·노트·모드별 새 대화 분리
- [x] AI 세션 ID와 Codex `threadId` SQLite 저장
- [x] 과거 대화 선택 시 저장된 Codex Thread 이어서 실행
- [x] Thread 복원 실패 시 새 Thread로 안전하게 분기
- [x] Prompt·응답·상태·문서 revision을 Turn 이력으로 저장
- [x] 앱 재시작 후 SQLite Turn 이력을 Prompt 세션 화면에 복원
- [x] 질문·조사 대화에는 이전 Turn 이후 노트 변경분만 전달
- [x] 편집 요청은 선택 영역 또는 현재 커서의 문단·제목·코드 블록만 전달
- [x] 커서만 있는 경우 가장 가까운 semantic text block을 자동 편집 대상으로 캡처
- [x] “추가·삽입” 요청은 현재 대상을 덮어쓰지 않고 앞/뒤에 새 HTML fragment 삽입
- [x] “문서 전체·노트 전체”가 명시된 경우에만 전체 문서를 편집 대상으로 전달
- [x] AI 실행 중 문서가 변경되면 저장한 range/revision의 적용을 차단
- [ ] 각 블록에 영구 ID를 부여해 다른 문단이 바뀐 뒤에도 대상 블록을 안전하게 재탐색
- [x] AI 결과 적용 revision 및 적용 상태 저장
- [x] 대화 삭제 시 세션과 Turn 이력 cascade 삭제
- [x] 세션 제목 직접 변경 및 Codex Thread 이름 동기화
- [x] Hermes 방식의 컨텍스트 초기화와 대화 영구 삭제 분리
- [x] 삭제 전 파괴적 작업 확인
- [x] 긴 대화 수동 요약 및 새 Thread 분기
- [x] Hermes 로컬 설정과 동일하게 실제 입력 컨텍스트 50% 도달 시 자동 연속성 요약 및 새 Thread 분기
- [x] 원본 Thread를 보존하고 새 Thread에 연속성 요약 주입
- [x] 누적 입력·출력·전체 토큰과 현재 입력 컨텍스트 토큰을 분리 저장
- [x] 대화별 컨텍스트 사용률과 진행 막대 표시

## MVP 2 사용 방법

### 사전 준비

1. Codex 또는 Claude CLI를 설치하고 로그인한다.
2. KsNote의 `설정 → AI Agent`에서 사용할 모델과 실행 명령을 확인한다.
3. Atlassian 자료를 조사하려면 Codex 환경에 Atlassian Rovo 플러그인을 설치하고 Atlassian 계정을 연결한다.
4. Rovo 연결 후에는 새 Codex 세션 또는 KsNote를 다시 실행한다.

### 노트 편집

1. 노트를 열고 화면 아래의 `AI에게 요청`을 누른다.
2. `노트 편집` 모드를 선택한다.
3. 전체 노트를 수정하려면 선택 없이 요청하고, 일부만 수정하려면 대상 텍스트나 표를 먼저 선택한다.
4. `이 문단을 세 줄로 줄여줘`, `이 표를 담당자별로 정리해줘`처럼 변경 내용을 입력한다.
5. 응답이 생성되면 `변경 전`과 `변경 후`를 비교한다.
6. `변경 적용`을 누르거나, 원문을 유지하려면 `노트에 삽입`을 선택한다.
7. AI 실행 중 노트가 변경되면 기존 결과 적용이 차단되므로 다시 요청한다.
8. 전체 노트 교체는 확인 창에서 한 번 더 승인한다.

### 노트에 질문

1. AI 패널에서 `질문` 모드를 선택한다.
2. `이 문서의 결정 사항은 뭐야?`처럼 현재 노트에 관한 질문을 입력한다.
3. 답변만 확인하거나 `노트에 삽입`을 눌러 인용 블록으로 보관한다.
4. 질문 모드는 기존 노트 내용을 직접 교체하지 않는다.

### Atlassian Rovo로 조사

1. AI 패널에서 `Rovo 조사` 모드를 선택한다. 조사 모드는 Codex에서 실행 가능한 OpenAI 모델을 사용한다.
2. Confluence 페이지 URL, Jira 이슈 URL 또는 이슈 키와 조사할 내용을 입력한다.
3. 예: `이 Confluence 페이지를 읽고 핵심 요구사항과 미결정 사항을 출처 링크와 함께 정리해줘.`
4. 외부로 전달되는 프롬프트와 현재 노트 내용에 대한 안내를 확인하고 실행을 승인한다.
5. Codex가 사용자 환경의 Atlassian Rovo MCP를 사용해 자료를 읽기 전용으로 조회한다.
6. 결과에 포함된 출처를 확인한 뒤 `노트에 삽입`을 눌러 인용 블록으로 저장한다.
7. 조사 모드에서는 Jira 이슈 생성·수정이나 Confluence 페이지 수정 작업을 실행하지 않는다.
8. Rovo를 사용할 수 없다는 메시지가 나오면 플러그인 설치, Atlassian 로그인, 사이트 접근 권한을 확인한다.

권장 요청 예시:

- `Atlassian Rovo로 이 Confluence 링크를 직접 읽고 제목, 최종 수정일, 핵심 내용을 요약해줘. 사용한 출처 URL을 표시해줘.`
- `이 Jira 이슈의 현재 상태, 담당자, 완료 조건과 최근 논의를 읽기 전용으로 정리해줘.`
- `Rovo 연결 상태를 확인하고 현재 인증 사용자와 접근 가능한 Atlassian 사이트를 알려줘. 아무것도 수정하지 마.`

### 실행 중 취소와 스트리밍

- 응답 생성 중에는 출력이 AI 패널에 순차적으로 표시된다.
- 실행을 멈추려면 응답 영역의 `중지`를 누른다.
- 취소된 요청은 노트에 자동 적용되지 않는다.

### Prompt 세션 다시 열기

1. AI 패널 상단의 기록 아이콘을 누른다.
2. `현재 노트` 또는 `프로젝트` 범위를 선택한다.
3. 이전 요청을 선택해 프롬프트와 응답을 다시 확인한다.
4. 과거 응답은 현재 선택 영역에 자동 재적용하지 않으며, 필요한 경우 `노트에 삽입`으로 안전하게 가져온다.
5. 필요 없는 기록은 세션 오른쪽의 삭제 버튼으로 제거한다.

### 오류 처리 요구사항

- CLI가 없으면 설치가 필요하다는 메시지와 확인할 명령을 표시한다.
- 로그인이 만료되면 Codex 또는 Claude 재로그인 방법을 표시한다.
- Rovo가 연결되지 않았으면 플러그인, OAuth 로그인, 사이트 권한 중 어느 단계가 실패했는지 구분한다.
- 선택 영역 또는 노트 revision이 바뀌면 변경 적용을 중단하고 재실행을 안내한다.
- AI 결과는 사용자가 명시적으로 적용하기 전까지 노트 본문을 변경하지 않는다.

### Ralph AI 표시 검증

1. `설정 → 개발자`에서 `AI 검증 로그`를 켠다.
2. AI 푸터에서 질문 또는 편집 요청을 실행한다.
3. 응답을 확인하고 필요한 경우 노트에 삽입하거나 변경을 적용한다.
4. `설정 → 개발자 → Ralph 검증 로그`에서 동일 Request ID의 `질문 → 응답 → 페이지 반영` 상태를 확인한다.
5. 상세 항목을 열어 프롬프트, AI 응답, 적용 전 페이지 HTML과 적용 후 페이지 HTML을 비교한다.
6. 자동 검증 또는 오류 보고에 사용하려면 `JSON 복사`로 전체 로그를 복사한다.
7. 페이지 본문이 포함될 수 있으므로 검증이 끝나면 로그를 초기화하고 개발자 모드를 끈다.

## 1. AI 푸터

- [x] AI 패널 열기/닫기
- [x] 노트 편집 모드
- [x] 질문 모드
- [x] 사용 가능한 OpenAI·Claude 모델 선택
- [x] 사용자 프롬프트 입력
- [x] Enter 전송, Shift+Enter 줄바꿈
- [x] 로딩 및 오류 표시
- [x] 결과를 노트에 삽입
- [x] 결과로 대상 범위 교체
- [x] 결과 취소
- [x] 표 전용 AI 프롬프트
- [x] 선택 영역이 정확히 유지되는 AI Patch
- [x] 적용 전 실제 diff 표시
- [x] AI Prompt 세션 목록
- [x] 프로젝트별 AI 대화 이력
- [x] 실행 중 취소
- [x] 응답 스트리밍
- [x] CLI 설치 및 로그인 자동 진단

## 2. AI 안전 편집

- [x] Codex를 read-only sandbox로 실행
- [x] 노트 편집 호출은 `--ignore-user-config`로 전역 모델/MCP 설정과 격리
- [x] Codex 로그인·버전 오류를 사용자용 메시지로 정리
- [x] Claude 도구 사용을 제한한 print 모드 실행
- [x] 앱이 계정 비밀번호나 웹 세션 쿠키를 저장하지 않음
- [x] 사용자 설정 CLI 명령의 위험한 shell 구분자 차단
- [ ] Block ID 기반 Patch Schema
- [x] revision 기반 충돌 확인
- [x] AI 변경 revision 자동 저장
- [x] 변경 전후 diff와 부분 선택 적용
- [x] 전체 노트 교체 경고
- [x] AI 실행 감사 로그
- [x] 개발자 모드 AI 질문·응답·페이지 반영 검증 로그
- [x] Request ID 기반 `질문 → 응답 → 페이지 반영` 상태 표시
- [x] Ralph 검증용 로그 JSON 복사와 초기화

## 3. 외부 MCP 조사 모드

목표: 일반 노트 편집은 전역 MCP와 계속 격리하되, 사용자가 명시적으로 선택한 조사 세션에서만 Atlassian Rovo를 통해 Jira와 Confluence 자료를 읽고 노트로 가져온다.

- [x] AI 푸터에 `조사` 모드 추가
- [x] 조사 모드와 일반 `노트 편집`·`질문` 모드를 시각적으로 구분
- [x] 조사 모드 진입 시 외부 서비스로 전송되는 노트·선택 영역·프롬프트 범위 안내
- [x] 요청마다 Atlassian Rovo 사용 여부를 사용자가 명시적으로 승인
- [x] 허용된 조사 세션에서만 Codex 사용자 설정과 Atlassian Rovo MCP 연결 활성화
- [x] 일반 편집 호출은 기존 `--ignore-user-config` 격리 유지
- [x] 조사 모드에서도 Codex 파일 시스템 sandbox는 read-only 유지
- [x] 허용 MCP 서버를 Atlassian Rovo로 제한하고 다른 전역 MCP 서버는 차단
- [x] Atlassian Rovo MCP 구성·활성화 상태 진단
- [ ] Atlassian 로그인 및 OAuth 연결 상태 진단
- [ ] 현재 인증 사용자와 접근 가능한 Atlassian 사이트 표시
- [ ] 접근 가능한 Jira 프로젝트와 Confluence 공간을 읽기 전용으로 조회
- [x] Confluence URL에서 site, space, page ID 자동 판별
- [x] Jira URL 또는 이슈 키에서 site, project, issue key 자동 판별
- [x] 프롬프트에 포함된 Atlassian 링크를 감지해 Rovo 조회 제안
- [ ] Confluence 페이지 제목·본문·작성자·최종 수정 시각 조회
- [ ] Jira 이슈의 요약·상태·담당자·설명·댓글 조회
- [ ] Rovo Search를 통한 Jira·Confluence 통합 검색
- [x] 가져온 자료마다 원본 URL과 조회 시각 표시
- [ ] 여러 페이지를 사용한 답변에 문장 또는 단락별 출처 표시
- [x] 접근 거부·페이지 없음·로그인 만료·OAuth 오류를 구분해 안내
- [x] 외부 자료 원문 출처와 AI 요약 결과를 구분해서 표시
- [x] 조사 결과를 현재 커서 위치에 인용 블록으로 삽입
- [x] 조사 결과로 선택 영역을 교체할 때 기존 AI Patch·diff 승인 절차 사용
- [x] 출처 링크를 유지한 Rich Text로 노트에 삽입
- [x] 조사 세션에 사용한 링크·검색어·조회 리소스·응답을 기록
- [x] 조사 세션 기록에서 원본 Atlassian 자료 다시 열기
- [x] 기본값은 읽기 전용이며 Jira 생성·수정과 Confluence 수정은 비활성화
- [ ] 외부 쓰기 기능은 별도 `작업 모드`와 실행 직전 확인 절차로 분리
- [x] 조사 종료 시 MCP 권한이 없는 일반 편집 컨텍스트로 복귀
- [x] 조사 감사 로그에 사용자 승인, 대상 링크, 성공·실패와 적용 revision 기록

### 조사 모드 권장 실행 흐름

1. 사용자가 `조사` 모드를 선택하고 Confluence 또는 Jira 링크를 입력한다.
2. KsNote가 Rovo 설치·로그인·사이트 접근 상태를 읽기 전용으로 진단한다.
3. 외부로 전달할 프롬프트와 노트 범위를 보여주고 사용자 승인을 받는다.
4. Atlassian Rovo만 허용한 격리된 Codex 프로세스가 자료를 조회한다.
5. KsNote가 답변, 원문 출처, 조회 시각을 함께 표시한다.
6. 사용자가 결과 삽입 또는 Patch 적용을 선택한다.
7. 조사 세션과 실제 노트 revision을 연결하고 일반 편집 모드로 복귀한다.

## MVP 2 완료 기준

- [x] 선택 영역 요약 → diff → 적용 → Undo가 안정적으로 동작한다.
- [x] 표를 AI로 수정해도 기존 셀 서식 속성이 유지된다.
- [x] AI 세션과 실제 노트 변경 revision이 연결된다.
- [x] Codex와 Claude가 동일한 JSON Patch 응답 규격을 사용한다.
- [x] 일반 편집에서는 외부 MCP가 차단되고 조사 모드에서 승인된 Atlassian Rovo만 동작한다.
- [x] Confluence/Jira 링크 조회 → 출처 확인 → 노트 삽입 → Undo 경로가 연결된다.
- [x] 조사 세션에 외부 전송 범위, 조회 출처, 사용자 승인과 실제 노트 변경 revision이 남는다.

## MVP 2.4 — Atlassian 게시

Codex App Server가 Atlassian Rovo MCP의 연결 상태, OAuth, 도구 스키마와 승인
이벤트를 중계하도록 구현한다. 첫 MVP는 현재 노트를 새 Confluence 페이지로
게시하는 범위만 지원하며, 로컬 이미지 업로드와 기존 페이지 수정은 제외한다.

상세 조사 및 적용 계획:
[KsNote × Codex App Server × Atlassian Rovo 게시 MVP](docs/atlassian-publish-mcp-mvp-plan.md)

---

# MVP 3 — KsNote MCP Server

목표: Codex가 KsNote의 프로젝트와 노트를 MCP Tool로 안전하게 검색하고 편집할 수 있게 한다.

상세 조사 문서: [KsNote × Codex MCP 연동 조사 및 100개 시나리오](docs/codex-mcp-integration-research.md)

현재 구현 추적: [MVP 3.1 — Codex 타깃 다이어그램 삽입 추적](docs/mvp3-targeted-diagram-tracking.md)

## Codex에서 기대하는 핵심 사용 흐름

사용자는 KsNote에서 페이지 또는 현재 커서/선택 영역 타깃을 복사한 뒤 Codex에
다음처럼 지시한다.

```text
@KsNote Codex에서 현재 폴더 코드 구조 확인한 이후,
프로젝트 > 페이지 현재 클릭한 지점에 다이어그램 저장해줘.
포맷은 Mermaid로 해줘.
```

기대 동작:

1. Codex가 현재 작업 폴더의 코드 구조를 읽고 다이어그램 초안을 만든다.
2. Codex가 `ksnote` MCP 서버에서 타깃 페이지와 현재 커서/선택 영역을 확인한다.
3. Codex가 Mermaid, PlantUML, draw.io 중 KsNote가 지원하는 포맷을 선택한다.
4. Codex가 쓰기 tool을 호출해 현재 커서에는 append, 선택 영역에는 replace로 다이어그램 블록이나 텍스트를 저장한다.
5. KsNote는 revision 충돌 여부를 확인하고, 성공 시 에디터에 외부 변경을 반영한다.

사용자가 복사하는 타깃 문자열은 다음 형태를 기본으로 한다.

```text
KsNote target: ksnote://page/<pageId>?block=<blockId>&offset=<offset>&from=<from>&to=<to>&revision=<revision>&operation=<operation>
Project: <project name/id>
Page: <page title>
Operation: append | replace-selection
Use KsNote MCP to insert the generated content into this target.
```

## Codex MCP 설정 가이드

기본 설치 흐름은 KsNote 앱 안에서 생성한 설정을 복사하는 방식이다.
`설정 → MCP 연결 → Codex 설정 복사`는 현재 실행 중인 앱의 설치 위치와
데이터베이스 경로를 감지해 TOML을 만든다.

개발 중에는 프로젝트 루트 기준 STDIO MCP 서버로 잡는다.

```toml
[mcp_servers.ksnote]
command = "node"
args = ["C:\\Users\\TOVIS\\Documents\\Note\\mcp\\ksnote-server.mjs"]
env = { KSNOTE_DB_PATH = "C:\\Users\\TOVIS\\AppData\\Roaming\\ksnote\\ksnote.db" }
```

설치본에서는 앱 실행 파일 자체가 MCP 서버 모드로 동작한다.

```toml
[mcp_servers.ksnote]
command = "C:\\Path\\To\\KsNote.exe"
args = ["C:\\Path\\To\\resources\\app.asar\\mcp\\ksnote-server.mjs"]
env = { ELECTRON_RUN_AS_NODE = "1", KSNOTE_DB_PATH = "C:\\Users\\TOVIS\\AppData\\Roaming\\ksnote\\ksnote.db" }
```

포터블 앱은 폴더를 옮기면 실행 파일 경로가 바뀌므로 `Codex 설정 복사`를 다시
눌러 현재 위치 기준 설정을 갱신한다. 데이터 위치를 함께 고정하려면
`KSNOTE_DB_PATH`를 명시한다.

또는 Codex CLI에서 다음 흐름을 제공한다.

```bash
codex mcp add ksnote -- node mcp/ksnote-server.mjs
codex mcp get ksnote
```

KsNote 앱에서는 `설정 → MCP 연결 → Codex 등록/업데이트` 버튼으로 같은 등록을
실행할 수 있다. Codex는 등록된 MCP 서버를 `~/.codex/config.toml`에서 읽고,
새 Codex 세션을 시작할 때 서버를 stdio로 실행한 뒤 `tools/list`로 사용 가능한
tool을 인식한다. 이미 열린 Codex 세션에는 새 MCP가 바로 붙지 않을 수 있으므로
등록 후에는 새 Codex 세션을 시작한다.

프로젝트 루트에서 직접 실행해 진단할 때는 다음 명령을 사용한다.

```bash
npm run mcp:ksnote
```

KsNote 설정 화면의 `MCP 연결` 탭은 이 설정을 복사하거나 생성할 수 있어야 한다.
설정 UI에는 다음 상태를 표시한다.

- `ksnote` MCP 서버 활성 여부
- 실제 실행 명령과 인자
- 연결 테스트 결과와 최근 오류
- 노출된 tool 목록
- 현재 페이지 ID와 현재 커서/선택 타깃 복사 버튼

## KsNote MCP Tool 계약

Codex가 노트 내용을 안전하게 읽고 삽입하려면 최소한 다음 tool이 필요하다.

- `workspace_get_context`
  - 현재 열린 프로젝트, 페이지, 커서/선택 범위, 저장소 루트, 현재 revision을 반환한다.
- `project_list`
  - Codex가 사용자의 "프로젝트 > 페이지" 표현을 실제 ID로 해석할 수 있게 한다.
- `note_get`
  - 페이지 HTML/JSON, 제목, revision, block 목록과 선택 영역 주변 문맥을 읽는다.
- `note_create`
  - 명시한 프로젝트에 새 페이지를 만들고 생성된 pageId를 operation 결과로 반환한다.
- `note_search`
  - 프로젝트 전체 구조나 관련 페이지를 검색한다.
- `diagram_insert`
  - Mermaid, PlantUML, draw.io를 전용 블록으로 삽입한다.
  - 입력값은 `targetRef`, `format`, `code`, `title`, `operation`, `expectedRevision`을 포함한다.
  - `operation`은 `insert`, `append`, `replace-selection`, 정확한 block ID 기반 `replace-block`을 지원한다.
  - Mermaid/PlantUML은 실제 SVG 렌더, draw.io는 embed load 후 SVG export가 성공해야 `completed`가 된다.
- `diagram_delete`
  - 안정 block ID를 포함한 명시적 `targetRef`와 최신 `expectedRevision`으로 다이어그램 한 개만 삭제한다.
  - 커서 fallback을 사용하지 않으며 대상이 다이어그램이 아니면 실패한다.
- `diagram_capabilities`
  - 현재 앱에서 Mermaid, PlantUML, draw.io 렌더러를 사용할 수 있는지와 권장 용도를 반환한다.
- `text_insert`
  - 일반 텍스트를 현재 커서, 선택 영역 또는 페이지 끝에 삽입한다.
  - 인코딩 손상으로 보이는 `??`/`�` 텍스트는 저장 전에 거부한다.
- `operation_get`
  - `diagram_insert`, `diagram_delete`, `text_insert`로 큐에 들어간 작업의 `pending`, `applying`, `completed`, `error`, `expired` 상태를 조회한다.
- `note_patch`
  - 다이어그램 외 일반 HTML/Markdown 조각을 삽입하거나 교체한다.

`diagram_insert`의 권장 입력 예시:

```json
{
  "targetRef": "ksnote://page/n1?from=42&to=42",
  "format": "mermaid",
  "title": "현재 코드 구조",
  "code": "flowchart LR\n  App[React App] --> Editor[RichDocumentEditor]",
  "operation": "append",
  "expectedRevision": "r3f2a91b"
}
```

지원 포맷 우선순위:

1. Mermaid: 기본 포맷. 코드 구조, 플로우, 시퀀스, ERD에 우선 사용한다.
2. PlantUML: UML sequence/class/component에 사용한다. JAR는 앱에 번들되며 로컬 Java 런타임이 필요하다.
3. draw.io: 사용자가 diagrams.net/draw.io 편집 가능한 다이어그램을 명시적으로 요구할 때 사용한다.

쓰기 tool은 `expectedRevision`이 전달되면 충돌 시 `revision_conflict`를 반환한다.
Codex는 충돌 방지가 필요한 작업에서 `note_get`으로 최신 revision을 읽은 뒤 전달하고,
충돌이 나면 최신 내용을 다시 읽고 사용자에게 재시도 여부를 물어야 한다.
작업 큐는 atomic write로 기록하며, KsNote 앱 heartbeat가 없거나 TTL을 넘긴 작업은
`operation_get`에서 `expired`로 확인된다.
Electron renderer는 창이 가려지거나 최소화된 상태에서도 heartbeat와 MCP operation
polling을 유지하므로, 백그라운드 절전 때문에 열린 앱을 닫힌 앱으로 오판하지 않는다.

## 1. 저장소 기반

- [ ] `localStorage` 데이터를 SQLite로 마이그레이션
- [ ] Project Repository
- [ ] Note Repository
- [ ] Block Repository
- [ ] Asset Repository
- [ ] Task Repository
- [ ] Revision Repository
- [ ] 기존 사용자 데이터 자동 마이그레이션
- [ ] Electron과 MCP 프로세스의 동시 접근 처리
- [ ] 외부 변경 시 에디터 자동 갱신

## 2. 읽기 전용 MCP Tools

- [x] `workspace_get_context`
- [x] `project_list`
- [ ] `note_search`
- [x] `note_get`
- [x] `diagram_capabilities`
- [x] 앱 heartbeat 조회
- [ ] `task_query`
- [ ] `asset_get`
- [ ] `history_list`
- [ ] pagination
- [ ] 검색 결과 score와 snippet
- [ ] block/heading 범위 읽기

## 3. 쓰기 MCP Tools

- [x] `note_create`
- [ ] `note_patch`
- [x] `text_insert`
- [x] `diagram_insert`
- [x] `diagram_delete`
- [x] `operation_get`
- [ ] `note_move`
- [ ] `task_update`
- [ ] `history_restore`
- [x] expected revision 검사
- [x] 작업 queue atomic write
- [x] pending/applying/completed/error/expired 상태
- [x] operation TTL
- [x] append/replace-selection/replace-block/insert operation 처리
- [x] Mermaid/PlantUML 실제 SVG 렌더 검증
- [x] draw.io embed load + SVG export 렌더 검증
- [x] 렌더 provenance와 `data-render-status="verified"` 저장
- [x] 텍스트 인코딩 손상 의심 입력 차단
- [ ] 최소 block patch
- [ ] 쓰기 전 diff
- [ ] 쓰기 승인
- [x] 충돌 응답

## 4. Codex 연결

- [x] `mcp/ksnote-server.mjs`
- [x] STDIO transport
- [x] 서버 `instructions`
- [x] Tool `description`
- [x] `inputSchema`와 구조화 응답
- [x] `readOnlyHint`와 위험 annotation
- [ ] 프로젝트 `.codex/config.toml`
- [x] `codex mcp add ksnote` 설치 흐름
- [x] KsNote 설정 UI에서 설정 파일 생성
- [x] MCP 상태와 연결 결과 토스트 표시
- [ ] MCP 도구 목록/오류 로그 표시
- [x] 현재 페이지 ID 복사 UI
- [x] 현재 커서/선택 타깃 복사 UI
- [x] block ID, offset, revision을 포함한 안정적인 타깃 복사
- [x] 다른 페이지 MCP 작업의 대상 페이지 자동 라우팅
- [x] 설정 화면에 Codex용 KsNote MCP 연결 가이드 표시

## MVP 3 완료 기준

- [x] Codex에서 현재 노트와 선택 영역을 읽을 수 있다.
- [x] Codex가 `text_insert`로 현재 페이지에 일반 텍스트를 삽입할 수 있다.
- [x] Codex가 `diagram_insert`로 현재 클릭 지점에 Mermaid/PlantUML/draw.io 블록을 삽입할 수 있다.
- [x] Codex가 안정 block ID로 기존 다이어그램을 교체하거나 정확히 삭제할 수 있다.
- [x] Codex가 `diagram_capabilities`로 적합한 다이어그램 형식을 선택할 수 있다.
- [ ] 프로젝트 전체 노트를 검색할 수 있다.
- [x] 쓰기 작업은 변경 미리보기 후 사용자 승인을 요구한다.
- [x] UI와 Codex가 동시에 편집할 때 expected revision이 있으면 자동 덮어쓰지 않는다.
- [x] 완료 operation은 SQLite 저장 확인 뒤 성공을 반환하며 토스트에서 즉시 Undo할 수 있다.
- [ ] 모든 MCP 변경을 history에서 복구할 수 있다.

---

# MVP 4 — Converter와 외부 도구

목표: KsNote의 문서를 Jira, Confluence, GitHub, Markdown과 업무 도구에 맞게 변환하고 전송한다.

- [ ] Markdown ↔ Rich Document 무손실 변환
- [ ] Markdown → Jira 변환
- [ ] Markdown → Confluence 변환
- [ ] Markdown → GitHub 변환
- [ ] 표 플랫폼별 호환 변환
- [ ] Jira MCP 연결
- [ ] Confluence MCP 연결
- [ ] GitHub MCP 연결
- [ ] Local Files MCP 연결
- [ ] 실행 전 승인 화면
- [ ] 실행 결과와 외부 URL을 노트에 기록
- [ ] 회의 노트에서 Jira 티켓 생성
- [ ] 노트에서 GitHub Issue 생성
- [ ] 프로젝트 Context Capsule

---

# AI에게 전달할 개발 지침

아래 내용을 다음 AI 개발 세션의 기본 프롬프트로 사용할 수 있습니다.

```text
당신은 KsNote 데스크톱 앱을 개발한다.

제품 목표:
KsNote는 Confluence/Word처럼 본문을 직접 편집하면서 표, 코드, 이미지,
Mermaid, 체크리스트와 AI 편집을 한 화면에서 제공하는 로컬 우선 AI 작업 공간이다.

작업 시작 규칙:
1. README.md의 MVP 체크리스트를 먼저 읽는다.
2. [x] 기능을 다시 만들거나 기존 동작을 제거하지 않는다.
3. 사용자가 요청한 기능과 직접 관련된 [ ] 항목만 구현한다.
4. 현재 데이터를 보존하며 기존 localStorage key를 임의로 변경하지 않는다.
5. Rich Editor는 TipTap/ProseMirror 구조를 유지한다.
6. 표, 이미지, 코드, Mermaid와 체크리스트는 문자열이 아닌 실제 편집 가능한 block/node로 처리한다.
7. AI 편집은 전체 덮어쓰기보다 선택 영역 또는 block 단위 patch를 우선한다.
8. 쓰기·삭제·복구·외부 전송은 적용 전 대상을 분명히 표시한다.
9. MCP Tool은 읽기와 쓰기를 분리하고 Description에 사용 시점, 선행 조건,
   부작용, 승인 조건을 기록한다.
10. 작업 후 npm run build와 관련 동작을 검증한다.

UX 원칙:
- 여러 단계보다 커서 위치에서 바로 실행되는 흐름을 우선한다.
- `/` 입력으로 삽입 가능한 블록을 검색할 수 있어야 한다.
- 팝업을 열더라도 현재 선택 영역과 커서 위치를 잃지 않아야 한다.
- 문서는 소스 코드가 아니라 최종 모양으로 보이고 그 자리에서 수정되어야 한다.
- 오류는 빈 화면으로 두지 말고 원인과 해결 방법을 표시한다.
- 설정은 상단 및 하단 `…` 메뉴에서 접근할 수 있어야 한다.
- 키보드와 마우스 모두로 같은 핵심 기능을 실행할 수 있어야 한다.

완료 보고 규칙:
- 구현한 README 체크박스를 [x]로 갱신한다.
- 아직 동작하지 않는 기능을 완료로 표시하지 않는다.
- 변경 파일, 사용자 동작, 검증 결과와 남은 제한을 보고한다.
```

## 개발 시 주의할 현재 제한

- 현재 노트 데이터는 SQLite에 저장되며, 외부 MCP 프로세스는 `KSNOTE_DB_PATH`로 DB를 읽는다.
- SQLite export와 MCP operation JSON은 임시 파일에 완전히 쓴 뒤 원자 교체하며, Windows 파일 공유 충돌은 제한 재시도한다.
- 패키지 renderer asset은 Electron `file://` 로딩을 위해 `./assets/...` 상대 경로를 사용한다.
- 분할 프리뷰는 별도 Mermaid 렌더링 단계가 필요하다.
- 설정 화면의 MCP 항목은 Codex 등록과 설정 복사를 지원하지만, 이미 열린 Codex 세션에는 새 MCP가 즉시 반영되지 않을 수 있다.
- MCP 쓰기 작업은 operation queue를 통해 열려 있는 KsNote 앱이 적용하므로 앱 heartbeat가 필요하다.
- PlantUML JAR는 패키지 리소스로 번들되며 실행 환경에는 Java 런타임이 필요하다.
- draw.io 편집 블록은 diagrams.net embed를 사용하므로 인터넷 연결이 필요하다.
- 현재 내보내기는 HTML 문서 내용을 `.md`로 저장할 수 있으므로 정식 변환기가 필요하다.
- 대용량 Mermaid 번들에 대한 code splitting이 필요하다.

## 검증 명령

```powershell
npm run build
npm run test:mvp
node scripts/verify-diagram-e2e.mjs --page-id <pageId>
node scripts/verify-diagram-e2e.mjs --page-id <pageId> --package-dir <win-unpacked>
git diff --check
```
