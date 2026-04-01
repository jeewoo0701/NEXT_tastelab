-- 기존 데이터베이스 지우기 (초기화용 - 필요 시 활성화)
-- DROP TABLE IF EXISTS public.songs;
-- DROP TABLE IF EXISTS public.participants;
-- DROP TABLE IF EXISTS public.rooms;

-- 1. rooms 테이블 생성 (방 목록)
CREATE TABLE public.rooms (
    id text PRIMARY KEY,
    status text NOT NULL DEFAULT 'waiting',
    game_mode text NOT NULL DEFAULT 'blind_test', -- 'blind_test' 또는 'world_cup'
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. participants 테이블 생성 (참가자 목록)
CREATE TABLE public.participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    nickname text NOT NULL,
    is_host boolean NOT NULL DEFAULT false,
    score integer DEFAULT 0,
    joined_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    vote_for text
);

-- 3. songs 테이블 생성 (제출된 곡 목록을 일괄 관리)
CREATE TABLE public.songs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    submitter_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    video_id text NOT NULL,
    is_played boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. 실시간 통신(Realtime) 사용을 위해 테이블 추가
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table participants;
alter publication supabase_realtime add table songs;

-- 5. 보안 규칙 (RLS) 개방: 테스트와 원활한 멀티플레이를 위해 모두 허용
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all operations for rooms" ON public.rooms FOR ALL USING (true);
CREATE POLICY "Enable all operations for participants" ON public.participants FOR ALL USING (true);
CREATE POLICY "Enable all operations for songs" ON public.songs FOR ALL USING (true);

-- ==========================================================
-- (선택) 기존에 만든 테이블을 지우지 않고 새 컬럼 및 테이블만 추가하려면 이 아래 코드를 실행하세요.
-- ALTER TABLE public.rooms ADD COLUMN game_mode text NOT NULL DEFAULT 'blind_test';
-- ALTER TABLE public.participants DROP COLUMN IF EXISTS submitted_url;
-- ALTER TABLE public.participants ADD COLUMN vote_for text;
-- 위의 3. songs 테이블 생성 구문과 RLS 설정은 따로 실행해야 합니다.
