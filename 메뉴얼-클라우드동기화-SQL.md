# 스텝 4 — Supabase SQL (한 번만)

코드 배포 후 **반드시** 이 SQL을 실행해야 동기화가 됩니다.

1. **https://supabase.com** → 프로젝트 선택
2. 왼쪽 **SQL Editor**
3. **+ New query**
4. 이 저장소 파일 내용 전체 복사:  
   `supabase/bus-cloud-setup.sql`
5. 붙여넣기 → **Run** (실행)
6. 에러 없이 끝나면 OK

## 확인

1. **Table Editor** 에 `bus_user_data` 테이블이 보임
2. **Storage** 에 `bus-photos` 버킷이 보임
3. 앱에서 로그인 → 정류장 등록 → 「클라우드에 저장했습니다」 문구
4. 다른 기기에서 같은 구글로 로그인 → 같은 정류장 목록

## 동기화가 실패할 때

- SQL을 아직 실행 안 함 → 위 1~5 다시
- 로그인 안 함 → 「다른 폰에서도 보기」에서 구글 로그인
- `enabled: false` in `cloud-sync.config.json` → true 여야 함 (기본 true)

## 비용·용량

- 계정당 정류장 **최대 30개** (앱에서 제한)
- 사진 파일 **5MB** 이하 (버킷 설정)