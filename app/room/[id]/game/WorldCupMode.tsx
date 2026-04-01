'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Pause, Mic, CheckCircle2, Trophy, ArrowRight, Maximize } from 'lucide-react'
import YouTube from 'react-youtube'
import { supabase } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

const extractVideoId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return (match && match[2].length === 11) ? match[2] : null
}

export default function WorldCupMode({ roomId, nickname, isHost }: { roomId: string, nickname: string, isHost: boolean }) {
  const router = useRouter()
  
  const [participants, setParticipants] = useState<any[]>([])
  const [songs, setSongs] = useState<any[]>([])
  
  // Phase 관리
  const [gamePhase, setGamePhase] = useState<'submit' | 'match' | 'finished'>('submit')
  
  // 제출 관련
  const [inputUrl, setInputUrl] = useState('')
  const totalSongs = songs.length

  // 월드컵 토너먼트 상태 (Host 전용 & Broadcast 동기화)
  const [roundName, setRoundName] = useState('16강')
  const [matchName, setMatchName] = useState('1경기')
  const [songA, setSongA] = useState<any>(null)
  const [songB, setSongB] = useState<any>(null)
  const [activePlayer, setActivePlayer] = useState<'A' | 'B' | null>(null) // 현재 재생 중인 곡
  
  // 호스트용 큐 상태
  const [currentQueue, setCurrentQueue] = useState<any[]>([]) // 이번 라운드 대기열
  const [nextQueue, setNextQueue] = useState<any[]>([]) // 다음 승자 대기열
  
  const playerARef = useRef<any>(null)
  const playerBRef = useRef<any>(null)
  const containerARef = useRef<HTMLDivElement>(null)
  const containerBRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<any>(null)

  const me = participants.find(p => p.nickname === nickname)
  const votesA = participants.filter(p => p.vote_for === 'A').length
  const votesB = participants.filter(p => p.vote_for === 'B').length

  useEffect(() => {
    const fetchState = async () => {
      const nocache = Math.random().toString()
      const { data: pData } = await supabase.from('participants').select('*').eq('room_id', roomId).neq('nickname', nocache)
      if (pData) setParticipants(pData)
      const { data: sData } = await supabase.from('songs').select('*').eq('room_id', roomId).neq('video_id', nocache)
      if (sData) setSongs(sData)
    }
    fetchState()

    const pgChannel = supabase.channel(`wc-pg-${roomId}-game`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'songs', filter: `room_id=eq.${roomId}` }, () => fetchState())
      .subscribe()

    const gameChannel = supabase.channel(`game-control-${roomId}-v2`, { config: { broadcast: { self: false } } })
    gameChannel.on('broadcast', { event: 'game_control' }, ({ payload }) => {
      if (payload.action === 'start_match') {
        setGamePhase('match')
        setRoundName(payload.roundName)
        setMatchName(payload.matchName)
        setSongA(payload.songA)
        setSongB(payload.songB)
        setActivePlayer(null)
      } else if (payload.action === 'play_track') {
        setGamePhase('match')
        setActivePlayer(payload.track)
        if (payload.track === 'A' && playerARef.current) { playerARef.current.playVideo(); playerBRef.current?.pauseVideo() }
        if (payload.track === 'B' && playerBRef.current) { playerBRef.current.playVideo(); playerARef.current?.pauseVideo() }
      } else if (payload.action === 'pause_all') {
        setGamePhase('match')
        setActivePlayer(null)
        playerARef.current?.pauseVideo()
        playerBRef.current?.pauseVideo()
      } else if (payload.action === 'finished') {
        setGamePhase('finished')
        setSongA(payload.winner)
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
    
    if (!inputUrl.trim() || !me || totalSongs >= 16) return
    const vId = extractVideoId(inputUrl)
    if (!vId) return alert('유효한 YouTube URL을 입력해주세요.')

    // 서버 DB에 16곡이 초과되었는지 안전하게 한 번 더 체크 (동시 클릭 뚫림 방지)
    const { count } = await supabase.from('songs').select('*', { count: 'exact', head: true }).eq('room_id', roomId);
    if ((count || 0) >= 16) {
      alert('이미 16곡 접수가 마감되었습니다!');
      return;
    }

    // Optimistic Update
    const mockId = Math.random().toString()
    const mockSong = { id: mockId, room_id: roomId, submitter_id: me.id, video_id: vId, is_played: false }
    setSongs(prev => [...prev, mockSong])
    setInputUrl('')

    const { data, error } = await supabase.from('songs').insert({ 
      room_id: roomId, submitter_id: me.id, video_id: vId 
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

  // 호스트 전용: 배열 셔플 (초기 대진표 생성 시 사용)
  const shuffle = (array: any[]) => array.sort(() => Math.random() - 0.5)

  const handleCreateTournament = async () => {
    if (songs.length !== 16) return alert('정확히 16곡이 접수되어야 합니다.')
    const shuffled = shuffle([...songs])
    const newQueue = [...shuffled]
    
    const pA = newQueue.shift()
    const pB = newQueue.shift()
    
    setCurrentQueue(newQueue)
    setNextQueue([])
    
    // 첫 경기 세팅
    setRoundName('16강')
    setMatchName('1경기')
    setSongA(pA)
    setSongB(pB)
    setGamePhase('match')
    
    broadcastAction({ action: 'start_match', roundName: '16강', matchName: '1경기', songA: pA, songB: pB })
  }

  // 승자 결정하여 다음 경기로
  const handleAdvance = async (winnerLabel: 'A' | 'B') => {
    const winnerSong = winnerLabel === 'A' ? songA : songB
    const newNextQueue = [...nextQueue, winnerSong]
    
    // 투표 기록 리셋
    await supabase.from('participants').update({ vote_for: null }).eq('room_id', roomId)

    // 남은 대기열이 없고 다음 라운드로 가야 한다면?
    let cQ = [...currentQueue]
    let nQ = newNextQueue
    let rName = roundName
    let mIdx = parseInt(matchName.replace('경기','')) + 1

    if (cQ.length === 0) {
      if (nQ.length === 1) {
        // 모든 토너먼트 종료 (우승자 결정)
        setGamePhase('finished')
        setSongA(nQ[0])
        broadcastAction({ action: 'finished', winner: nQ[0] })
        return
      }
      // 라운드 승격 (16강 -> 8강 -> 4강 -> 결승)
      cQ = shuffle(nQ)
      nQ = []
      if (cQ.length === 8) rName = '8강'
      else if (cQ.length === 4) rName = '4강'
      else if (cQ.length === 2) rName = '결승전'
      mIdx = 1
    }

    const nextA = cQ.shift()
    const nextB = cQ.shift()

    setCurrentQueue(cQ)
    setNextQueue(nQ)
    setRoundName(rName)
    setMatchName(`${mIdx}경기`)
    setSongA(nextA)
    setSongB(nextB)
    setActivePlayer(null)
    
    broadcastAction({ action: 'start_match', roundName: rName, matchName: `${mIdx}경기`, songA: nextA, songB: nextB })
  }

  const handleVote = async (choice: 'A' | 'B') => {
    if (gamePhase !== 'match' || !me) return
    // 즉각적인 로컬 UI 반영 (Optimistic Update)
    setParticipants(prev => prev.map(p => p.id === me.id ? { ...p, vote_for: choice } : p))
    await supabase.from('participants').update({ vote_for: choice }).eq('id', me.id)
  }

  const playHostA = () => { 
    setActivePlayer('A'); 
    playerARef.current?.playVideo(); 
    playerBRef.current?.pauseVideo();
    broadcastAction({ action: 'play_track', track: 'A' });
  }
  const playHostB = () => { 
    setActivePlayer('B'); 
    playerBRef.current?.playVideo(); 
    playerARef.current?.pauseVideo();
    broadcastAction({ action: 'play_track', track: 'B' });
  }
  const pauseHost = () => { 
    setActivePlayer(null); 
    playerARef.current?.pauseVideo(); 
    playerBRef.current?.pauseVideo();
    broadcastAction({ action: 'pause_all' });
  }

  return (
    <div className="flex-1 flex flex-col p-8 w-full max-w-5xl mx-auto h-screen relative">
      <header className="flex justify-between items-center py-6 border-b border-gray-800">
        <div className="text-gray-400 tracking-[0.2em] text-xs">WORLD CUP MODE</div>
        <div className="text-center">
          <h1 className="text-xl md:text-2xl tracking-[0.4em] font-light text-electric-blue">{roundName} {gamePhase === 'match' && `- ${matchName}`}</h1>
        </div>
        <div className="text-gray-400 tracking-[0.2em] text-xs uppercase">{nickname} {isHost && '(HOST)'}</div>
      </header>

      <main className="flex-1 overflow-y-auto py-8 flex flex-col relative">
        {gamePhase === 'submit' && (
          <div className="flex flex-col items-center w-full max-w-lg mx-auto mt-12">
            <h2 className="text-lg tracking-[0.3em] font-light mb-8 text-center">
              16강 대진표 구성을 위해<br/> <span className="text-electric-blue font-bold">총 16곡의 유튜브 URL</span>을 접수합니다.
            </h2>
            <p className="text-xs text-gray-500 mb-8 tracking-widest text-center">인원 제한 없이 중복해서 제출이 가능합니다!</p>

            <form onSubmit={handleSubmitUrl} className="w-full relative">
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://youtu.be/..."
                className="w-full bg-pure-black border border-gray-800 py-4 px-6 text-sm outline-none focus:border-electric-blue placeholder-gray-700"
                disabled={totalSongs >= 16}
              />
              <button 
                type="submit" 
                disabled={!inputUrl.trim() || totalSongs >= 16} 
                className="mt-4 w-full py-4 tracking-widest text-sm bg-pure-white text-pure-black hover:bg-electric-blue hover:text-pure-white transition-colors disabled:opacity-50"
              >
                제출하기 ( {totalSongs} / 16 )
              </button>
            </form>

            {/* 제출 현황 시각화 */}
            <div className="mt-8 grid grid-cols-4 gap-2 w-full">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className={`h-8 border ${i < totalSongs ? 'bg-electric-blue border-electric-blue' : 'border-gray-800 bg-transparent'} transition-colors`}/>
              ))}
            </div>

            {isHost && (
              <button
                onClick={handleCreateTournament}
                disabled={totalSongs !== 16}
                className="mt-12 py-4 px-8 w-full border border-electric-blue text-electric-blue hover:bg-electric-blue hover:text-pure-white tracking-[0.3em] disabled:opacity-30 transition-all text-sm font-bold"
              >
                대진표 셔플 및 토너먼트 시작
              </button>
            )}
          </div>
        )}

        {gamePhase === 'match' && (
          <div className="w-full h-full flex flex-col pt-4">
            {!isHost ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                 <h2 className="text-2xl tracking-[0.4em] font-light text-electric-blue mb-8">대결 진행중</h2>
                 <p className="text-gray-400 tracking-[0.2em] mb-12">빔프로젝터 스피커의 소리에 집중하세요.</p>
                 <div className="flex space-x-12">
                   <div className={`p-8 border ${activePlayer === 'A' ? 'border-electric-blue bg-electric-blue/10 animate-pulse' : 'border-gray-800'} rounded-full`}>
                     A
                   </div>
                   <div className="text-sm font-bold text-gray-700 self-center">VS</div>
                   <div className={`p-8 border ${activePlayer === 'B' ? 'border-electric-blue bg-electric-blue/10 animate-pulse' : 'border-gray-800'} rounded-full`}>
                     B
                   </div>
                 </div>
              </div>
            ) : (
              // 빔프로젝터용 호스트 화면
              <div className="w-full flex-1 flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-8">
                {/* A 선수 */}
                <div className={`flex-1 flex flex-col border ${activePlayer === 'A' ? 'border-electric-blue shadow-[0_0_30px_rgba(0,195,255,0.3)]' : 'border-gray-800'} transition-all`}>
                  <div className="bg-gray-900 py-2 text-center text-xs tracking-[0.3em] text-gray-400">후보 A</div>
                  <div ref={containerARef} className="aspect-video w-full bg-black relative group">
                     {songA && (
                       <YouTube 
                         videoId={songA.video_id} 
                         className={`absolute inset-0 w-full h-full pointer-events-none ${activePlayer === 'A' ? 'opacity-100' : 'opacity-10'}`}
                         opts={{ width: '100%', height: '100%', playerVars: { controls: 0 } }} 
                         onReady={(e: any) => { playerARef.current = e.target }} 
                       />
                     )}
                     <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 cursor-pointer" onClick={() => activePlayer === 'A' ? pauseHost() : playHostA()}>
                       {activePlayer === 'A' ? <Pause size={48} className="text-electric-blue"/> : <Play size={48} className="text-white"/>}
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); containerARef.current?.requestFullscreen() }} className="absolute top-4 right-4 z-50 p-2 text-white/50 hover:text-white transition-colors">
                       <Maximize size={20} />
                     </button>
                  </div>
                  <div className="p-4 flex flex-col space-y-4 text-center">
                    <h3 className="text-sm font-light text-gray-500">투표 수: <span className="text-electric-blue font-bold text-2xl ml-2">{votesA}</span></h3>
                    <button onClick={() => handleAdvance('A')} className="py-3 bg-pure-white text-pure-black uppercase text-xs font-bold tracking-[0.2em] hover:bg-electric-blue hover:text-white transition-colors">
                      A 다음 라운드 진출
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">VS</span>
                </div>

                {/* B 선수 */}
                <div className={`flex-1 flex flex-col border ${activePlayer === 'B' ? 'border-electric-blue shadow-[0_0_30px_rgba(0,195,255,0.3)]' : 'border-gray-800'} transition-all`}>
                  <div className="bg-gray-900 py-2 text-center text-xs tracking-[0.3em] text-gray-400">후보 B</div>
                  <div ref={containerBRef} className="aspect-video w-full bg-black relative group">
                     {songB && (
                       <YouTube 
                         videoId={songB.video_id} 
                         className={`absolute inset-0 w-full h-full pointer-events-none ${activePlayer === 'B' ? 'opacity-100' : 'opacity-10'}`}
                         opts={{ width: '100%', height: '100%', playerVars: { controls: 0 } }} 
                         onReady={(e: any) => { playerBRef.current = e.target }} 
                       />
                     )}
                     <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 cursor-pointer" onClick={() => activePlayer === 'B' ? pauseHost() : playHostB()}>
                       {activePlayer === 'B' ? <Pause size={48} className="text-electric-blue"/> : <Play size={48} className="text-white"/>}
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); containerBRef.current?.requestFullscreen() }} className="absolute top-4 right-4 z-50 p-2 text-white/50 hover:text-white transition-colors">
                       <Maximize size={20} />
                     </button>
                  </div>
                  <div className="p-4 flex flex-col space-y-4 text-center">
                    <h3 className="text-sm font-light text-gray-500">투표 수: <span className="text-electric-blue font-bold text-2xl ml-2">{votesB}</span></h3>
                    <button onClick={() => handleAdvance('B')} className="py-3 bg-pure-white text-pure-black uppercase text-xs font-bold tracking-[0.2em] hover:bg-electric-blue hover:text-white transition-colors">
                      B 다음 라운드 진출
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {gamePhase === 'finished' && (
          <div className="flex-1 flex flex-col items-center justify-center mt-8">
            <Trophy size={64} className="text-electric-blue mb-8 animate-bounce" />
            <h1 className="text-4xl tracking-[0.4em] font-bold text-pure-white mb-4">WORLD CUP CHAMPION</h1>
            <p className="text-gray-400 tracking-[0.3em] mb-12">최종 우승곡 축하합니다!</p>

            <div className="max-w-2xl w-full border border-electric-blue p-2 bg-black aspect-video mb-8">
               {songA && isHost ? (
                 <YouTube 
                   videoId={songA.video_id} 
                   className="w-full h-full"
                   opts={{ width: '100%', height: '100%', playerVars: { autoplay: 1 } }} 
                 />
               ) : (
                 <div className="w-full h-full flex flex-col items-center justify-center">
                    <p className="text-gray-400 tracking-[0.2em] mb-4">호스트의 화면(스피커)을 확인하세요!</p>
                 </div>
               )}
            </div>

            <div className="text-xs text-gray-500 tracking-widest border border-gray-800 px-6 py-4 mb-16">
               이 곡을 제출했던 참가자:
               <span className="text-electric-blue text-sm uppercase ml-4 p-2 border border-electric-blue inline-block">
                 {participants.find(p => p.id === songA?.submitter_id)?.nickname || '알 수 없음'}
               </span>
            </div>

            <div className="w-full max-w-2xl text-left border border-gray-800 p-8 mb-12 bg-pure-black/50">
               <h3 className="text-sm tracking-[0.4em] text-gray-400 mb-6 border-b border-gray-800 pb-4">WORLD CUP 16-TRACK ARCHIVE</h3>
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
              <button 
                onClick={() => {
                  broadcastAction({ action: 'return_to_lobby' })
                  router.push(`/room/${roomId}?nickname=${encodeURIComponent(nickname)}&isHost=${isHost}`)
                }} 
                className="mt-12 border border-pure-white px-8 py-3 tracking-widest hover:bg-pure-white hover:text-pure-black transition-colors"
              >
                로비로 돌아가기
              </button>
            )}
          </div>
        )}
      </main>

      {/* 참가자 투표 패널 (Match 진행 중일 때만) */}
      {gamePhase === 'match' && (
        <footer className="py-6 border-t border-gray-800 relative z-10 w-full flex space-x-4">
           <button 
             onClick={() => handleVote('A')} 
             className={`flex-1 py-6 border transition-all duration-300 font-bold tracking-[0.3em] text-sm ${me?.vote_for === 'A' ? 'border-electric-blue bg-electric-blue/10 text-electric-blue shadow-[0_0_15px_rgba(0,195,255,0.4)]' : 'border-gray-800 text-gray-500 hover:text-pure-white'}`}
           >
             [ A ] 투표
           </button>
           <button 
             onClick={() => handleVote('B')} 
             className={`flex-1 py-6 border transition-all duration-300 font-bold tracking-[0.3em] text-sm ${me?.vote_for === 'B' ? 'border-electric-blue bg-electric-blue/10 text-electric-blue shadow-[0_0_15px_rgba(0,195,255,0.4)]' : 'border-gray-800 text-gray-500 hover:text-pure-white'}`}
           >
             [ B ] 투표
           </button>
        </footer>
      )}
    </div>
  )
}
