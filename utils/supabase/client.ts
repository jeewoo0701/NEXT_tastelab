import { createClient } from '@supabase/supabase-js'

// .env.local 파일에 설정될 변수들을 사용합니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// 브라우저 및 클라이언트 측에서 사용할 수 있는 싱글톤 클라이언트
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
