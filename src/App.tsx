import { useState } from 'react'
import { useRaceClock } from './hooks/useRaceClock'
import { useNow } from './hooks/useNow'
import { useStore } from './store'
import { fmtTimeOfDay } from './lib/time'
import { SetupView } from './components/SetupView'
import { RaceView } from './components/RaceView'
import { ResultsView } from './components/ResultsView'
import backgroundUrl from './assets/Tubanters background without logo.png'
import logoUrl from './assets/logo-tubanters-header.svg'

type Tab = 'setup' | 'race' | 'results'

export function App() {
  useRaceClock()
  const now = useNow(250)
  const [tab, setTab] = useState<Tab>('race')

  const raceName = useStore((s) => s.config.raceName)
  const running = useStore((s) => s.running)
  const paused = useStore((s) => s.paused)
  const count = useStore((s) => s.participants.length)

  const status = !running ? 'idle' : paused ? 'paused' : 'running'

  return (
    <div className="app" style={{ backgroundImage: `url(${backgroundUrl})` }}>
      <header className="topbar">
        <div className="brand">
          <img src={logoUrl} alt="Tubanters" className="brand-logo" />
          <span className="brand-name">{raceName || 'Time Trial'}</span>
          <span className={`status-pill status-${status}`}>{status}</span>
        </div>

        <nav className="tabs">
          <button className={tab === 'setup' ? 'tab active' : 'tab'} onClick={() => setTab('setup')}>
            Setup <span className="tab-badge">{count}</span>
          </button>
          <button className={tab === 'race' ? 'tab active' : 'tab'} onClick={() => setTab('race')}>
            Race
          </button>
          <button
            className={tab === 'results' ? 'tab active' : 'tab'}
            onClick={() => setTab('results')}
          >
            Results
          </button>
        </nav>

        <div className="tod" title="Time of day">
          {fmtTimeOfDay(now)}
        </div>
      </header>

      <main className="content">
        {tab === 'setup' && <SetupView />}
        {tab === 'race' && <RaceView />}
        {tab === 'results' && <ResultsView />}
      </main>
    </div>
  )
}
