import { useState } from 'react'
import { Toaster } from 'sonner'
import Navbar from '@/components/Navbar'
import MarketData from '@/pages/MarketData'
import Download from '@/pages/Download'
import Strategy from '@/pages/Strategy'
import Backtest from '@/pages/Backtest'
import Tasks from '@/pages/Tasks'
import Settings from '@/pages/Settings'

function App() {
  const [activeTab, setActiveTab] = useState('market')

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === 'market' && <MarketData />}
        {activeTab === 'download' && <Download />}
        {activeTab === 'strategy' && <Strategy />}
        {activeTab === 'backtest' && <Backtest />}
        {activeTab === 'tasks' && <Tasks />}
        {activeTab === 'settings' && <Settings />}
      </main>
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
      />
    </div>
  )
}

export default App
