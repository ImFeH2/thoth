import { useCallback, useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { useAppSettings } from '@/lib/appSettings'
import { api } from '@/services/api'
import ComboBox from '@/components/ComboBox'
import type { Timeframe, AvailableCandleInfo } from '@/types'

interface BacktestProps {
  onTaskCreated?: () => void
}

export default function Backtest({ onTaskCreated }: BacktestProps) {
  const settings = useAppSettings()
  const [strategies, setStrategies] = useState<string[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState<string>('')
  const [selectedExchange, setSelectedExchange] = useState<string>('')
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe | ''>('')
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)

  const [availableData, setAvailableData] = useState<AvailableCandleInfo[]>([])

  const loadStrategies = useCallback(async () => {
    try {
      const response = await api.strategy.list()
      setStrategies(response.strategies)
      if (response.strategies.length > 0) {
        setSelectedStrategy(response.strategies[0])
      }
    } catch (error) {
      console.error('Failed to load strategies:', error)
    }
  }, [])

  const loadAvailableData = useCallback(async () => {
    try {
      const data = await api.candles.available()
      setAvailableData(data)

      if (data.length > 0) {
        const preferredData = data.find((item) =>
          item.exchange === settings.defaults.exchange
          && item.symbol === settings.defaults.symbol
          && item.timeframe === settings.defaults.timeframe
        ) ?? data.find((item) =>
          item.exchange === settings.defaults.exchange
          && item.symbol === settings.defaults.symbol
        ) ?? data.find((item) => item.exchange === settings.defaults.exchange) ?? data[0]

        setSelectedExchange(preferredData.exchange)
        setSelectedSymbol(preferredData.symbol)
        setSelectedTimeframe(preferredData.timeframe)
      }
    } catch (error) {
      console.error('Failed to load available data:', error)
    }
  }, [settings.defaults.exchange, settings.defaults.symbol, settings.defaults.timeframe])

  useEffect(() => {
    loadAvailableData()
    loadStrategies()
  }, [loadAvailableData, loadStrategies])

  const availableExchanges = Array.from(new Set(availableData.map((data) => data.exchange)))

  const availableSymbols = selectedExchange
    ? Array.from(new Set(
      availableData
        .filter((data) => data.exchange === selectedExchange)
        .map((data) => data.symbol)
    ))
    : []

  const availableTimeframes = selectedExchange && selectedSymbol
    ? Array.from(new Set(
      availableData
        .filter((data) => data.exchange === selectedExchange && data.symbol === selectedSymbol)
        .map((data) => data.timeframe)
    ))
    : []

  const handleRunBacktest = useCallback(async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (!selectedStrategy || !selectedSymbol || !selectedTimeframe) return
    if (runningRef.current) return

    try {
      runningRef.current = true
      setRunning(true)
      await api.backtest.create({
        name: selectedStrategy,
        exchange: selectedExchange,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
      })
      onTaskCreated?.()
    } catch (error) {
      console.error('Failed to run backtest:', error)
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [onTaskCreated, selectedStrategy, selectedExchange, selectedSymbol, selectedTimeframe])

  const canRunBacktest = selectedStrategy && selectedSymbol && selectedTimeframe && !running

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-medium text-gray-900 mb-2">Backtest</h1>
            <p className="text-gray-500">Test your trading strategies against historical data</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Configuration</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Strategy
                </label>
                <ComboBox
                  options={strategies}
                  value={selectedStrategy}
                  onChange={setSelectedStrategy}
                  placeholder="Select strategy..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exchange
                </label>
                <ComboBox
                  options={availableExchanges}
                  value={selectedExchange}
                  onChange={setSelectedExchange}
                  placeholder="Select exchange..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Symbol
                </label>
                <ComboBox
                  options={availableSymbols}
                  value={selectedSymbol}
                  onChange={setSelectedSymbol}
                  placeholder="Select symbol..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Timeframe
                </label>
                <ComboBox
                  options={availableTimeframes}
                  value={selectedTimeframe}
                  onChange={(value) => setSelectedTimeframe(value as Timeframe)}
                  placeholder="Select timeframe..."
                />
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={handleRunBacktest}
                disabled={!canRunBacktest}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-4 h-4" />
                {running ? 'Running Backtest...' : 'Run Backtest'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
