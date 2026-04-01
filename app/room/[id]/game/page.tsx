'use client'

import { useSearchParams, useParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase/client'
import BlindTestMode from './BlindTestMode'
import WorldCupMode from './WorldCupMode'

function GameEntry() {
  const params = useParams()
  const searchParams = useSearchParams()
  
  const roomId = params.id as string
  const nickname = searchParams.get('nickname') || 'GUEST'
  const isHost = searchParams.get('isHost') === 'true'

  const [gameMode, setGameMode] = useState<'blind_test' | 'world_cup' | null>(null)

  useEffect(() => {
    const fetchRoomMode = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('game_mode')
        .eq('id', roomId)
        .single()
        
      if (data) {
        setGameMode(data.game_mode)
      }
    }
    
    fetchRoomMode()
  }, [roomId])

  if (!gameMode) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 tracking-[0.3em] text-sm h-screen">
        LOADING GAME MODE...
      </div>
    )
  }

  if (gameMode === 'world_cup') {
    return <WorldCupMode roomId={roomId} nickname={nickname} isHost={isHost} />
  }

  return <BlindTestMode roomId={roomId} nickname={nickname} isHost={isHost} />
}

export default function GamePage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center text-gray-500 tracking-[0.3em] text-sm h-screen">
        LOADING GAME...
      </div>
    }>
      <GameEntry />
    </Suspense>
  )
}
