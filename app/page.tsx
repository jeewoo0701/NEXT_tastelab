'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/utils/supabase/client'
import { Crown, User } from 'lucide-react'

export default function EntryPage() {
  const [nickname, setNickname] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleHostJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim() || isLoading) return
    setIsLoading(true)
    
    try {
      // 호스트 전용 메인 방(MAIN) 무조건 덮어쓰기 (초기화 효과)
      await supabase.from('rooms').upsert({ id: 'MAIN', status: 'waiting', game_mode: 'blind_test' })
      
      // 기존 잔여 데이터(참가자, 제출곡) 모두 삭제하여 방 청소
      await supabase.from('participants').delete().eq('room_id', 'MAIN')
      await supabase.from('songs').delete().eq('room_id', 'MAIN')
      
      // 방장으로 등록
      await supabase.from('participants').insert([{ room_id: 'MAIN', nickname: nickname.trim(), is_host: true }])
      
      router.push(`/room/MAIN?nickname=${encodeURIComponent(nickname.trim())}&isHost=true`)
    } catch (error) {
      console.error(error)
      alert('방 입장 중 오류가 발생했습니다.')
      setIsLoading(false)
    }
  }

  const handleGuestJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim() || isLoading) return
    setIsLoading(true)

    try {
      // 방 존재 여부/상태 체크 생략하고 바로 참가자로 등록
      await supabase.from('participants').insert([{ room_id: 'MAIN', nickname: nickname.trim(), is_host: false }])
      
      router.push(`/room/MAIN?nickname=${encodeURIComponent(nickname.trim())}&isHost=false`)
    } catch (error) {
       console.error(error)
       alert('방 입장 중 오류가 발생했습니다.')
       setIsLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 w-full">
      <div className="text-center mb-16 space-y-4">
        <h1 className="text-2xl md:text-4xl tracking-[0.4em] font-light">THE TASTE ARCHIVE</h1>
        <h2 className="text-xs md:text-sm tracking-[0.5em] text-gray-500">CURATED SOUNDS & AESTHETICS</h2>
      </div>

      <div className="w-full max-w-sm flex flex-col space-y-8">
        <div className="relative w-full">
          <label 
            htmlFor="nickname" 
            className="block text-xs text-gray-400 mb-2 tracking-[0.2em]"
          >
            ENTER NICKNAME
          </label>
          <input
            id="nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full bg-pure-black border-b border-pure-white py-3 text-lg outline-none transition-colors duration-300 focus:border-electric-blue placeholder-gray-700"
            placeholder="NICKNAME"
            required
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <div className="flex flex-col space-y-4">
          <button
            onClick={handleHostJoin}
            disabled={!nickname.trim() || isLoading}
            className="w-full py-4 flex items-center justify-center border border-electric-blue text-electric-blue font-bold tracking-[0.3em] text-sm hover:bg-electric-blue hover:text-pure-white transition-all disabled:opacity-30"
          >
            <Crown size={16} className="mr-2" />
            호스트(방장)로 입장
          </button>
          
          <button
            onClick={handleGuestJoin}
            disabled={!nickname.trim() || isLoading}
            className="w-full py-4 flex items-center justify-center border border-pure-white bg-pure-white text-pure-black font-bold tracking-[0.3em] text-sm hover:bg-gray-200 transition-all disabled:opacity-30"
          >
            <User size={16} className="mr-2" />
            참가자로 입장
          </button>
        </div>
      </div>

      <div className="absolute bottom-8 text-[10px] text-gray-600 tracking-[0.2em]">
        © {new Date().getFullYear()} NEXT REFINEMENT INSTITUTE.
      </div>
    </div>
  )
}
