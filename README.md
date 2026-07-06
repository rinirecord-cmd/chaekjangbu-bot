# 책 장부 텔레그램 봇

텔레그램으로 책 표지 사진과 정보(제목/가격/출판사/작가/유형)를 보내면
[책 장부](https://app.notion.com/p/39268191f4cf804ca96acbd9daf97783) 노션 데이터베이스에 자동으로 기록해주는 봇이에요.

## 사용법 (텔레그램에서)

1. `@Bookbooklover_bot`과의 대화방에서 `/start`를 보내면 형식 안내를 받아요.
2. 책 표지 사진을 캡션과 함께 보내면 한 번에 기록돼요. 캡션 예시:
   ```
   제목: 아몬드
   가격: 13000
   출판사: 창비
   작가: 손원평
   유형: 소설
   ```
3. 사진만 먼저 보내도 괜찮아요 — 봇이 빠진 정보를 물어봐 주고, 답장으로 채우면 자동 저장돼요.
4. 입력을 잘못 시작했다면 `/cancel`로 초기화할 수 있어요.

## 지금 바로 쓰기 (로컬 실행 — 맥이 켜져 있을 때만 작동)

```bash
cd 책장부봇
npm install       # 이미 설치되어 있으면 생략
npm start
```

`.env` 파일에 이미 토큰이 채워져 있어요. 맥을 끄거나 재부팅하면 봇도 같이 멈춰요.
다시 켜고 싶으면 위 명령을 다시 실행하면 돼요.

## 24시간 계속 돌리기 (Render 무료 배포)

맥을 꺼도 항상 작동하게 하려면, 무료 클라우드 호스팅에 올려야 해요. 여기서는 **Render**를 기준으로 안내해요 (가입 시 신용카드 필요 없음, 무료지만 몇 분간 조용하면 잠들었다가 다음 메시지가 오면 30초 정도 뒤에 깨어나요 — 개인용으로는 충분해요).

### 1단계. GitHub에 코드 올리기

이 폴더는 이미 git 저장소로 초기화되어 있어요 (`.env`는 안전하게 제외됨). 아래만 하면 돼요:

1. [github.com/new](https://github.com/new) 에서 새 저장소를 만드세요 (Private 추천, 이름 예: `chaekjangbu-bot`). "Initialize with README" 체크는 끄세요.
2. 터미널에서:
   ```bash
   cd 책장부봇
   git remote add origin https://github.com/<내-깃허브-아이디>/chaekjangbu-bot.git
   git branch -M main
   git push -u origin main
   ```

### 2단계. Render에 배포하기

1. [render.com](https://render.com) 가입 후 로그인.
2. **New +** → **Web Service** 선택 → 방금 만든 GitHub 저장소 연결.
3. 설정:
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Instance Type**: Free
4. **Environment Variables**에 아래 4개를 추가하세요 (`.env` 파일 내용을 그대로 복사):
   - `TELEGRAM_BOT_TOKEN`
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`
   - `WEBHOOK_URL` → Render가 배포 후 알려주는 주소 (예: `https://chaekjangbu-bot.onrender.com`, **끝에 슬래시(/) 없이**)
5. **Create Web Service** 클릭 → 배포 완료까지 2~3분 대기.
6. 배포된 주소가 실제로 `WEBHOOK_URL`과 정확히 일치하는지 확인 후, 값이 다르면 환경변수를 고치고 재배포하세요.

배포가 끝나면 텔레그램에서 봇에게 메시지를 보내보세요. 로컬에서 켜둔 `npm start`는 그만 꺼도 돼요 (동시에 두 곳에서 실행하면 폴링/웹훅이 충돌할 수 있어요).

## 주의할 점

- `.env` 파일은 절대 GitHub에 올리지 마세요 (이미 `.gitignore`에 포함되어 있어요).
- 책 표지 이미지는 텔레그램 서버에 저장된 파일 링크를 그대로 노션에 연결하는 방식이에요. 아주 드물게 시간이 오래 지나면 이미지 링크가 깨질 수 있어요 (그래도 기록된 텍스트 정보는 그대로 남아요).
- 봇 토큰이 유출되면 다른 사람이 내 봇처럼 행동할 수 있어요. `.env`나 Render 환경변수 화면을 스크린샷으로 남기지 않는 걸 추천해요.
