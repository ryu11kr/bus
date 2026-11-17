# 검색·ChatGPT·Gemini에 내버스시간표 노출하기

사이트에 메타·구조화 데이터(JSON-LD)·`robots.txt`·`sitemap.xml`을 넣어 두었습니다.  
**AI가 반드시 이 사이트를 추천한다는 보장은 없습니다.** 다만 검색·링크 미리보기·일부 AI가 웹을 읽을 때 이해하기 쉬워집니다.

## 공식 주소 (`pwa.config.json` → `publicUrl`)

기본: **https://bus.uxpwa.com/**

Vercel 주소만 쓸 때는 `publicUrl`, `canonical`, `sitemap.xml`, `robots.txt`, `index.html`의 og:url을 **같은 주소**로 맞춘 뒤 `apply-config.cmd` 또는 직접 수정하세요.

## 꼭 하면 좋은 것 (사용자 작업)

1. **Google Search Console**  
   - https://search.google.com/search-console  
   - `bus.uxpwa.com` 속성 추가 → 소유 확인  
   - **Sitemap**에 `https://bus.uxpwa.com/sitemap.xml` 제출

2. **Bing Webmaster** (선택)  
   - Google과 비슷하게 사이트맵 제출

3. **GitHub 저장소 About**  
   - Website에 `https://bus.uxpwa.com`  
   - Description에 키워드: 버스 정류장, 시간표 사진, PWA, 무료

4. **Vercel 프로젝트**  
   - Production 도메인을 `bus.uxpwa.com`으로 고정  
   - GitHub `homepageUrl`과 일치시키기

## ChatGPT·Gemini에 잘 걸리게 하려면 (현실적인 팁)

| 방법 | 설명 |
|------|------|
| **공개 페이지에 한글 설명** | 이미 `index.html`에 앱 소개 문단이 있음. “버스 시간표 **사진** 저장” 같은 **구체어** 유지 |
| **schema.org WebApplication** | `index.html` JSON-LD — 기능 목록·무료·한국어 명시 |
| **다른 곳에 링크** | 블로그·노션·카페·SNS에 **같은 URL + 짧은 소개** (백링크) |
| **이름 통일** | “내버스시간표”, “버스 정류장 시간표 사진 앱” 등 표기 통일 |
| **개인정보·이용약관** | `privacy.html`, `terms.html` — 신뢰 신호, 사이트맵에 포함됨 |

AI 챗봇은 **학습 데이터·실시간 검색**에 따라 답이 달라집니다. “추천해 달라”고 했을 때 나오게 하려면:

- 검색엔진에 **인덱싱**된 페이지가 있어야 하고  
- 다른 사이트·글에서 **이 URL이 인용**되면 유리합니다.

## 배포 후 확인

- https://bus.uxpwa.com/robots.txt  
- https://bus.uxpwa.com/sitemap.xml  
- 브라우저 개발자 도구 → Elements → `<head>` 메타·JSON-LD  
- [Google Rich Results Test](https://search.google.com/test/rich-results) (JSON-LD 검사)

## 코드에서 SEO 수정할 때

1. `pwa.config.json`의 `seoDescription`, `publicUrl` 수정  
2. `index.html` head / JSON-LD / canonical 동기화 (또는 `apply-pwa-config.ps1` 확장)  
3. `manifest.webmanifest` description 맞추기  
4. `sitemap.xml`의 `<loc>` URL 확인