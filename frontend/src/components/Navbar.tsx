import { TrendingUp } from 'lucide-react'

interface NavbarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

const tabs = [
  { id: 'market', label: 'Market Data' },
  { id: 'download', label: 'Download' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'settings', label: 'Settings' },
]

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          <div className="flex items-center gap-3 mr-8">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <span className="text-lg font-medium text-gray-900">Fettle</span>
          </div>

          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
