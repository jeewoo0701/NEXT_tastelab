'use client'

import { useSearchParams, useParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase/client'
import { Users, Play, LogOut, Copy } from 'lucide-react'

// 임시 참가자 타입
type Participant = {
  id: string
  nickname: string
  isHost: boolean
}

function RoomContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const roomId = params.id as string
  const nickname = searchParams.get('nickname') || 'GUEST'
  const isHost = searchParams.get('isHost') === 'true'

  // 실서버 연동 상태
  const [participants, setParticipants] = useState<Participant[]>([])

  // 방장 전용 모드 선택 (blind_test | world_cup)
  const [gameMode, setGameMode] = useState<'blind_test' | 'world_cup'>('blind_test')

  useEffect(() => {
    // 1. 초기 참가자 목록 로드
    const fetchParticipants = async () => {
      const { data, error } = await supabase
        .from('participants')
        .select('id, nickname, is_host')
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true })

      if (data) {
        setParticipants(data.map(p => ({
          id: p.id,
          nickname: p.nickname,
          isHost: p.is_host
        })))
      }
    }

    fetchParticipants()

    // 2. Realtime 참가자 변경 구독
    const participantsChannel = supabase
      .channel(`room-participants-${roomId}`)
      .on('postgres_changes', {
        event: '*', 
        schema: 'public',
        table: 'participants',
        filter: `room_id=eq.${roomId}`
      }, () => {
        fetchParticipants() // 목록 새로고침
      })
      .subscribe()

    // 3. Realtime 방 상태(게임 시작) 구독
    const roomChannel = supabase
      .channel(`room-status-${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`
      }, (payload) => {
        if (payload.new.status === 'playing') {
          router.push(`/room/${roomId}/game?nickname=${encodeURIComponent(nickname)}&isHost=${isHost}`)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(participantsChannel)
      supabase.removeChannel(roomChannel)
    }
  }, [roomId, nickname, isHost, router])

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId)
    alert('방 코드가 복사되었습니다.')
  }

  const handleStartGame = async () => {
    if (!isHost) return
    
    // 게임 시작 시, 이전에 남아있던 곡 데이터를 모두 초기화하여 충돌 방지
    await supabase.from('songs').delete().eq('room_id', roomId)
    
    // 게임 시작 시 방 상태를 playing으로, 게임 모드를 설정.
    const { error } = await supabase
      .from('rooms')
      .update({ status: 'playing', game_mode: gameMode })
      .eq('id', roomId)
      
    if (error) {
      console.error('Error starting game:', error)
      alert('게임을 시작할 수 없습니다.')
    }
  }

  const handleLeaveRoom = async () => {
    if (confirm('방을 나가시겠습니까?')) {
      // 본인이 참가자 목록에서 지워지도록 DB 삭제
      await supabase
        .from('participants')
        .delete()
        .eq('room_id', roomId)
        .eq('nickname', nickname)
        
      router.push(`/`)
    }
  }

  return (
    <div className="flex-1 flex flex-col p-8 w-full max-w-4xl mx-auto h-screen relative">
      {/* 헤더 */}
      <header className="flex justify-between items-center py-6 border-b border-gray-800">
        <div className="flex items-center space-x-4">
          <button 
            onClick={handleLeaveRoom}
            className="text-gray-400 hover:text-pure-white transition-colors flex items-center"
          >
            <LogOut size={20} className="mr-2" />
            <span className="text-xs tracking-[0.2em]">LEAVE</span>
          </button>
        </div>
        <div className="text-center group cursor-pointer" onClick={copyRoomCode}>
          <h2 className="text-[10px] text-gray-500 tracking-[0.3em] mb-1">ROOM CODE</h2>
          <div className="flex items-center space-x-2 text-pure-white group-hover:text-electric-blue transition-colors">
            <h1 className="text-2xl md:text-3xl tracking-[0.4em] font-light">{roomId}</h1>
            <Copy size={16} />
          </div>
        </div>
        <div className="invisible md:visible w-20"></div> {/* 레이아웃 균형을 위한 빈 공간 */}
      </header>

      {/* 메인 컨텐츠 (참가자 목록 및 모드 선택) */}
      <main className="flex-1 flex flex-col items-center">
        {isHost && (
          <div className="w-full mt-8 mb-4 border border-gray-800 bg-pure-black p-6">
            <h3 className="text-xs tracking-[0.3em] text-gray-400 mb-4 text-center">SELECT GAME MODE</h3>
            <div className="flex space-x-4">
              <button 
                onClick={() => setGameMode('blind_test')}
                className={`flex-1 py-4 text-xs tracking-widest border transition-all ${gameMode === 'blind_test' ? 'border-electric-blue bg-electric-blue/10 text-electric-blue' : 'border-gray-800 text-gray-500 hover:border-gray-600'}`}
              >
                BLIND TEST (N라운드)
              </button>
              <button 
                onClick={() => setGameMode('world_cup')}
                className={`flex-1 py-4 text-xs tracking-widest border transition-all ${gameMode === 'world_cup' ? 'border-electric-blue bg-electric-blue/10 text-electric-blue' : 'border-gray-800 text-gray-500 hover:border-gray-600'}`}
              >
                MUSIC WORLD CUP (16강)
              </button>
            </div>
          </div>
        )}

        <div className="w-full mt-8 flex justify-between items-end mb-8 border-b border-gray-800 pb-4">
          <h3 className="text-sm tracking-[0.3em] text-gray-400 flex items-center">
            <Users size={16} className="mr-2" />
            PARTICIPANTS
          </h3>
          <span className="text-electric-blue text-sm tracking-widest">{participants.length} / 16</span>
        </div>

        <ul className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-y-auto max-h-[40vh] pb-8 pr-2 custom-scrollbar">
          {participants.map((p) => (
            <li 
              key={p.id} 
              className={`p-4 border ${p.isHost ? 'border-electric-blue bg-electric-blue/5' : 'border-gray-800 bg-pure-black'} flex flex-col items-center justify-center transition-all duration-300 h-24`}
            >
              <div className="flex items-center space-x-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${p.isHost ? 'bg-electric-blue animate-pulse' : 'bg-gray-500'}`} />
                <span className="text-sm tracking-widest uppercase truncate max-w-[100px]">{p.nickname}</span>
              </div>
              {p.isHost && <span className="text-[8px] text-electric-blue tracking-[0.2em] border border-electric-blue px-2 py-1">HOST</span>}
            </li>
          ))}
          
          {Array.from({ length: Math.max(0, (isHost ? 16 : 8) - participants.length) }).map((_, i) => (
            <li 
              key={`empty-${i}`} 
              className="p-4 border border-gray-900 border-dashed flex justify-center items-center h-24 opaque-50"
            >
              <span className="text-gray-700 text-[10px] tracking-widest">WAITING...</span>
            </li>
          ))}
        </ul>
      </main>

      {/* 하단 컨트롤 (호스트 전용) */}
      <footer className="py-6 flex justify-center shrink-0">
        {isHost ? (
          <button
            onClick={handleStartGame}
            className="w-full max-w-sm py-5 bg-pure-white text-pure-black font-bold tracking-[0.4em] text-sm flex justify-center items-center group hover:bg-electric-blue hover:text-pure-white transition-all duration-300"
          >
            <Play size={18} className="mr-3 group-hover:text-pure-white transition-colors" />
            START GAME
          </button>
        ) : (
          <div className="w-full max-w-sm py-5 border border-gray-800 text-gray-500 font-normal tracking-[0.3em] text-xs flex justify-center items-center text-center">
            WAITING FOR HOST TO START...
          </div>
        )}
      </footer>
    </div>
  )
}

export default function RoomPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center text-gray-500 tracking-[0.3em] text-sm h-screen">
        LOADING ROOM...
      </div>
    }>
      <RoomContent />
    </Suspense>
  )
}
