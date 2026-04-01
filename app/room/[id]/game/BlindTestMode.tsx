'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Pause, SkipForward, Mic, CheckCircle2, UserCircle2 } from 'lucide-react'
import YouTube from 'react-youtube'
import { supabase } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

const extractVideoId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return (match && match[2].length === 11) ? match[2] : null
}

export default function BlindTestMode({ roomId, nickname, isHost }: { roomId: string, nickname: string, isHost: boolean }) {
  const router = useRouter()
  
  const [participants, setParticipants] = useState<any[]>([])
  const [songs, setSongs] = useState<any[]>([])
  const [gamePhase, setGamePhase] = useState<'submit' | 'playing' | 'reveal' | 'finished'>('submit')
  const [currentRound, setCurrentRound] = useState(1)
  
  const [videoId, setVideoId] = useState<string | null>(null)
  const [submitterId, setSubmitterId] = useState<string | null>(null)
  const [videoTitle, setVideoTitle] = useState('곡 정보 로딩 중...')
  const [isPlaying, setIsPlaying] = useState(false)
  const [inputUrl, setInputUrl] = useState('')
  
  const playerRef = useRef<any>(null)
  const channelRef = useRef<any>(null)

  const me = participants.find(p => p.nickname === nickname)
  const hasSubmitted = songs.some(s => s.submitter_id === me?.id)
  const submittedCount = songs.length // 이 방식에선 1인당 1곡 제출
  const votedCount = participants.filter(p => Boolean(p.vote_for)).length

  useEffect(() => {
    const fetchState = async () => {
      const nocache = Math.random().toString()
      const { data: pData } = await supabase.from('participants').select('*').eq('room_id', roomId).neq('nickname', nocache).order('joined_at', { ascending: true })
      if (pData) setParticipants(pData)
      
      const { data: sData } = await supabase.from('songs').select('*').eq('room_id', roomId).neq('video_id', nocache)
      if (sData) setSongs(sData)
    }

    fetchState()

    const pgChannel = supabase.channel(`blind-pg-${roomId}-game`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'songs', filter: `room_id=eq.${roomId}` }, () => fetchState())
      .subscribe()

    const gameChannel = supabase.channel(`game-control-${roomId}-v2`, { config: { broadcast: { self: false } } })
    gameChannel.on('broadcast', { event: 'game_control' }, ({ payload }) => {
      if (payload.action === 'play') {
        setVideoId(payload.videoId)
        setSubmitterId(payload.submitterId)
        setGamePhase('playing')
        setIsPlaying(false)
      } else if (payload.action === 'pause') {
        setIsPlaying(false)
        if (playerRef.current) playerRef.current.pauseVideo()
      } else if (payload.action === 'resume') {
        setIsPlaying(true)
        if (playerRef.current) playerRef.current.playVideo()
      } else if (payload.action === 'reveal') {
        setIsPlaying(false)
        setGamePhase('reveal')
        if (playerRef.current) playerRef.current.pauseVideo()
      } else if (payload.action === 'next_round') {
        setCurrentRound(payload.round)
        setGamePhase('playing')
        setVideoId(payload.videoId)
        setSubmitterId(payload.submitterId)
        setIsPlaying(false)
      } else if (payload.action === 'finished') {
        setGamePhase('finished')
      } else if (payload.action === 'return_to_lobby') {
        router.push(`/room/${roomId}?nickname=${encodeURIComponent(nickname)}&isHost=${isHost}`)
      }
    }).subscribe()

    channelRef.current = gameChannel

    return () => {
      supabase.removeChannel(pgChannel)
      supabase.removeChannel(gameChannel)
    }
  }, [roomId])

  const broadcastAction = (payload: any) => {
    if (channelRef.current) channelRef.current.send({ type: 'broadcast', event: 'game_control', payload })
  }

  const handleSubmitUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputUrl.trim() || !me) return
    const vId = extractVideoId(inputUrl)
    if (!vId) return alert('유효한 YouTube URL을 입력해주세요.')

    // Optimistic Update
    const mockId = Math.random().toString()
    const mockSong = { id: mockId, room_id: roomId, submitter_id: me.id, video_id: vId, is_played: false }
    setSongs(prev => [...prev, mockSong])
    setInputUrl('')

    const { data, error } = await supabase.from('songs').insert({
      room_id: roomId,
      submitter_id: me.id,
      video_id: vId
    }).select()
    
    if (error) {
      console.error('Insert song error:', error)
      alert(`곡 제출 실패: ${error.message}`)
      return
    }
    
    // 확정된 DB 데이터로 교체
    if (data && data.length > 0) {
      setSongs(prev => prev.map(s => s.id === mockId ? data[0] : s))
    }
  }

  const handleStartRandomPlay = async () => {
    const unplayed = songs.filter(s => !s.is_played)
    if (unplayed.length === 0) return alert('제출된 곡이 없습니다.')

    const randomSelect = unplayed[Math.floor(Math.random() * unplayed.length)]
    
    // 로컬 UI 즉각 반영 (중복 플레이 방지)
    setSongs(prev => prev.map(s => s.id === randomSelect.id ? { ...s, is_played: true } : s))

    // DB 업데이트
    await supabase.from('songs').update({ is_played: true }).eq('id', randomSelect.id)

    setVideoId(randomSelect.video_id)
    setSubmitterId(randomSelect.submitter_id)
    setGamePhase('playing')
    setIsPlaying(false)
    
    broadcastAction({ action: 'play', videoId: randomSelect.video_id, submitterId: randomSelect.submitter_id })
  }

  const handleReveal = () => {
    setIsPlaying(false)
    setGamePhase('reveal')
    if (playerRef.current) playerRef.current.pauseVideo()
    
    if (playerRef.current?.getVideoData) {
      setVideoTitle(playerRef.current.getVideoData().title || '알 수 없는 곡')
    }
    broadcastAction({ action: 'reveal' })
  }

  const handleNextRound = async () => {
    // 모든 참가자 투표 초기화
    await supabase.from('participants').update({ vote_for: null }).eq('room_id', roomId)

    const unplayed = songs.filter(s => !s.is_played)
    if (unplayed.length === 0) {
      setGamePhase('finished')
      broadcastAction({ action: 'finished' })
      return
    }

    const nextRoundCount = currentRound + 1
    const randomSelect = unplayed[Math.floor(Math.random() * unplayed.length)]
    
    // 로컬 UI 즉각 반영 (마지막 라운드 종료를 위해 필수)
    setSongs(prev => prev.map(s => s.id === randomSelect.id ? { ...s, is_played: true } : s))

    // DB 업데이트
    await supabase.from('songs').update({ is_played: true }).eq('id', randomSelect.id)

    setCurrentRound(nextRoundCount)
    setGamePhase('playing')
    setVideoId(randomSelect.video_id)
    setSubmitterId(randomSelect.submitter_id)
    setIsPlaying(false)
    
    broadcastAction({ action: 'next_round', round: nextRoundCount, videoId: randomSelect.video_id, submitterId: randomSelect.submitter_id })
  }

  const handleVote = async (targetUserId: string) => {
    if (gamePhase !== 'playing' || !me) return
    // 즉각적인 로컬 UI 반영 (Optimistic Update)
    setParticipants(prev => prev.map(p => p.id === me.id ? { ...p, vote_for: targetUserId } : p))
    await supabase.from('participants').update({ vote_for: targetUserId }).eq('id', me.id)
  }

  const exitGame = () => {
    if (isHost) broadcastAction({ action: 'return_to_lobby' })
    router.push(`/room/${roomId}?nickname=${encodeURIComponent(nickname)}&isHost=${isHost}`)
  }

  return (
    <div className="flex-1 flex flex-col p-8 w-full max-w-4xl mx-auto h-screen relative">
      <header className="flex justify-between items-center py-6 border-b border-gray-800">
        <div className="text-gray-400 tracking-[0.2em] text-xs">ROOM: {roomId}</div>
        <div className="text-center">
          <h1 className="text-2xl tracking-[0.4em] font-light text-electric-blue">ROUND {currentRound}</h1>
        </div>
        <div className="text-gray-400 tracking-[0.2em] text-xs uppercase">{nickname} {isHost && '(HOST)'}</div>
      </header>

      <main className="flex-1 overflow-y-auto py-12 flex flex-col items-center relative">
        {gamePhase === 'submit' && (
          <div className="flex flex-col items-center w-full max-w-lg mt-12">
            <h2 className="text-lg tracking-[0.3em] font-light mb-8">
              이번 게임용 <span className="text-electric-blue font-bold">유튜브 URL</span> 제출 (1인 1곡)
            </h2>

            {hasSubmitted ? (
              <div className="w-full flex flex-col items-center p-8 border border-gray-800 bg-pure-black mt-4">
                <CheckCircle2 size={48} className="text-electric-blue mb-4 animate-pulse" />
                <p className="tracking-widest text-sm text-gray-400">제출 완료. 시작을 기다리는 중...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitUrl} className="w-full relative">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://youtu.be/..."
                  className="w-full bg-pure-black border border-gray-800 py-4 px-6 text-sm outline-none focus:border-electric-blue placeholder-gray-700"
                />
                <button type="submit" disabled={!inputUrl.trim()} className="mt-4 w-full py-4 tracking-widest text-sm bg-pure-white text-pure-black hover:bg-electric-blue hover:text-pure-white transition-colors disabled:opacity-50">
                  제출하기
                </button>
              </form>
            )}

            <div className="mt-12 w-full flex justify-between items-center text-xs tracking-widest text-gray-500 border-t border-gray-800 pt-6">
              <span>SUBMIT STATUS</span>
              <span className="text-electric-blue text-sm">[ {submittedCount} / {participants.length} ]</span>
            </div>

            {isHost && (
              <button
                onClick={handleStartRandomPlay}
                disabled={submittedCount === 0}
                className="mt-8 py-3 w-full border border-electric-blue text-electric-blue hover:bg-electric-blue hover:text-pure-white tracking-[0.3em] disabled:opacity-30 transition-all text-xs"
              >
                블라인드 테스트 시작하기 (무작위 1곡 선발)
              </button>
            )}
          </div>
        )}

        {(gamePhase === 'playing' || gamePhase === 'reveal') && (
          <div className="w-full flex flex-col items-center">
            <div className="mb-4 flex flex-col items-center justify-center w-full relative">
              {isHost ? (
                <div className="w-full max-w-2xl aspect-video border border-gray-800 bg-pure-black relative shadow-2xl z-10">
                  <YouTube 
                    videoId={videoId!} 
                    className="absolute inset-0 w-full h-full"
                    opts={{ width: '100%', height: '100%', playerVars: { autoplay: 0, controls: 1 } }} 
                    onReady={(e: any) => { playerRef.current = e.target; if (isPlaying) e.target.playVideo() }} 
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center my-8">
                  <div className="relative flex justify-center items-center w-32 h-32 md:w-48 md:h-48 rounded-full border border-gray-800 mb-8 overflow-hidden z-10">
                    {isPlaying && <div className="absolute inset-0 rounded-full border-t border-electric-blue animate-spin" />}
                    <Mic size={48} className={isPlaying ? 'text-electric-blue animate-pulse' : 'text-gray-600'} />
                  </div>
                  <p className="text-gray-400 tracking-[0.2em] text-sm">호스트의 빔프로젝터/스피커를 들어주세요!</p>
                </div>
              )}
            </div>

            {isHost && gamePhase === 'playing' && (
              <div className="w-full max-w-2xl mb-8 flex space-x-2 z-10">
                <button 
                  onClick={() => { setIsPlaying(!isPlaying); isPlaying ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo(); broadcastAction({ action: isPlaying ? 'pause' : 'resume'}) }}
                  className="w-16 flex items-center justify-center p-3 text-pure-white border border-gray-800 hover:border-electric-blue transition-colors bg-pure-black"
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button 
                  onClick={handleReveal}
                  className="flex-1 flex items-center justify-center p-3 bg-pure-white text-pure-black hover:bg-electric-blue hover:text-pure-white transition-colors tracking-widest text-xs"
                >
                  <SkipForward size={14} className="mr-2"/> 정답 공개
                </button>
              </div>
            )}

            {gamePhase === 'reveal' && (
              <div className="w-full bg-pure-black/90 flex flex-col items-center justify-center p-8 border border-gray-800 mt-4">
                <h3 className="text-sm tracking-[0.4em] text-gray-400 mb-4">정답공개</h3>
                <h2 className="text-xl md:text-3xl tracking-[0.2em] font-bold text-electric-blue mb-8 text-center">{videoTitle}</h2>
                <div className="text-center mb-12">
                  <p className="text-xs tracking-widest text-gray-500 mb-2">이 곡을 제출한 사람</p>
                  <div className="text-2xl tracking-[0.3em] uppercase p-4 border border-electric-blue text-pure-white inline-block">
                    {participants.find(p => p.id === submitterId)?.nickname || '알 수 없음'}
                  </div>
                </div>

                {isHost && (
                  <button onClick={handleNextRound} className="py-4 px-12 bg-pure-white text-pure-black font-bold tracking-[0.2em] hover:bg-electric-blue hover:text-pure-white transition-colors">
                    다음 곡 랜덤 재생 (NEXT ROUND)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {gamePhase === 'finished' && (
          <div className="flex flex-col items-center justify-center mt-20 w-full pd-bottom-20">
            <h2 className="text-3xl tracking-[0.3em] text-electric-blue mb-4">GAME OVER</h2>
            <p className="text-gray-400 tracking-widest mb-12">모든 곡이 소진되었습니다.</p>
            
            <div className="w-full max-w-2xl text-left border border-gray-800 p-8 mb-12 bg-pure-black/50">
               <h3 className="text-sm tracking-[0.4em] text-gray-400 mb-6 border-b border-gray-800 pb-4">SUBMITTED PLAYLIST ARCHIVE</h3>
               <ul className="space-y-4">
                 {songs.map((song, i) => (
                   <li key={song.id} className="flex flex-col md:flex-row justify-between text-xs tracking-widest text-pure-white border-b border-gray-900 pb-2">
                      <span className="mb-2 md:mb-0">
                         <span className="text-gray-600 mr-2">TRACK {String(i + 1).padStart(2, '0')}.</span>
                         <a href={`https://youtu.be/${song.video_id}`} target="_blank" rel="noreferrer" className="text-electric-blue hover:text-pure-white hover:underline transition-colors">
                           youtu.be/{song.video_id}
                         </a>
                      </span>
                      <span className="text-gray-500">BY. <span className="text-pure-white uppercase">{participants.find(p => p.id === song.submitter_id)?.nickname || 'UNKNOWN'}</span></span>
                   </li>
                 ))}
               </ul>
            </div>
            {isHost && (
              <button onClick={exitGame} className="border border-pure-white px-8 py-3 tracking-widest hover:bg-pure-white hover:text-pure-black transition-colors">
                로비로 돌아가기
              </button>
            )}
          </div>
        )}
      </main>

      {gamePhase === 'playing' && (
        <footer className="py-6 border-t border-gray-800 relative z-10 w-full">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs text-gray-500 tracking-[0.2em]">이 곡을 제출한 사람에게 투표하세요</span>
            <span className="text-xs text-electric-blue tracking-widest">[ {votedCount} / {participants.length} ] VOTED</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {participants.map((p) => {
              const isSelected = me?.vote_for === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => handleVote(p.id)}
                  className={`flex flex-col items-center justify-center py-4 border transition-all duration-300 ${isSelected ? 'border-electric-blue bg-electric-blue/10 text-electric-blue' : 'border-gray-800 bg-pure-black text-gray-400 hover:border-gray-500 hover:text-pure-white'}`}
                >
                  <UserCircle2 size={24} className="mb-2" />
                  <span className="text-xs tracking-widest uppercase">{p.nickname}</span>
                </button>
              )
            })}
          </div>
        </footer>
      )}
    </div>
  )
}
