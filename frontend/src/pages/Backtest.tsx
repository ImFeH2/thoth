import { useEffect, useState, useRef, useCallback } from 'react'
import { Play, Clock, CheckCircle, XCircle, Loader, TrendingUp, TrendingDown, X } from 'lucide-react'
import { api } from '@/services/api'
import { useBacktestStream } from '@/hooks/useBacktestStream'
import ComboBox from '@/components/ComboBox'
import CandlestickChart from '@/components/CandlestickChart'
import BacktestResult from '@/components/BacktestResult'
import type { Timeframe, BacktestTask, AvailableCandleInfo, Candle, Trade } from '@/types'
import type { CandlestickData, SeriesMarker, Time } from 'lightweight-charts'

export default function Backtest() {
  const [strategies, setStrategies] = useState<string[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState<string>('')
  const [selectedExchange, setSelectedExchange] = useState<string>('')
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe | ''>('')
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const [availableData, setAvailableData] = useState<AvailableCandleInfo[]>([])
  const [tradeMarkers, setTradeMarkers] = useState<SeriesMarker<Time>[]>([])
  const [chartData, setChartData] = useState<CandlestickData[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [loadedChartTaskId, setLoadedChartTaskId] = useState<string | null>(null)
  const loadingChartRef = useRef(false)
  const [showResultView, setShowResultView] = useState(false)

  const { tasks, connected } = useBacktestStream()

  useEffect(() => {
    loadAvailableData()
    loadStrategies()
  }, [])

  const loadStrategies = async () => {
    try {
      const response = await api.strategy.list()
      setStrategies(response.strategies)
      if (response.strategies.length > 0) {
        setSelectedStrategy(response.strategies[0])
      }
    } catch (error) {
      console.error('Failed to load strategies:', error)
    }
  }

  const loadAvailableData = async () => {
    try {
      const data = await api.candles.available()
      setAvailableData(data)

      if (data.length > 0) {
        setSelectedExchange(data[0].exchange)
        setSelectedSymbol(data[0].symbol)
        setSelectedTimeframe(data[0].timeframe)
      }
    } catch (error) {
      console.error('Failed to load available data:', error)
    }
  }

  const availableExchanges = Array.from(new Set(availableData.map(d => d.exchange)))

  const availableSymbols = selectedExchange
    ? Array.from(new Set(
      availableData
        .filter(d => d.exchange === selectedExchange)
        .map(d => d.symbol)
    ))
    : []

  const availableTimeframes = selectedExchange && selectedSymbol
    ? Array.from(new Set(
      availableData
        .filter(d => d.exchange === selectedExchange && d.symbol === selectedSymbol)
        .map(d => d.timeframe)
    ))
    : []

  const convertTradesToMarkers = (trades: Trade[]): SeriesMarker<Time>[] => {
    return trades.map(trade => {
      const isBuy = trade.trade_type === 'market_buy' || trade.trade_type === 'limit_buy'
      const isLimit = trade.trade_type === 'limit_buy' || trade.trade_type === 'limit_sell'

      return {
        time: (trade.timestamp / 1000) as Time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#26a69a' : '#ef5350',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${isLimit ? 'LIMIT' : 'MARKET'} ${isBuy ? 'BUY' : 'SELL'} ${trade.amount} @ ${trade.price}`,
      }
    })
  }

  const handleRunBacktest = useCallback(async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (!selectedStrategy || !selectedSymbol || !selectedTimeframe) return
    if (runningRef.current) return

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    abortControllerRef.current = new AbortController()

    try {
      runningRef.current = true
      setRunning(true)
      await api.backtest.create({
        name: selectedStrategy,
        exchange: selectedExchange,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
      })
    } catch (error) {
      console.error('Failed to run backtest:', error)
    } finally {
      runningRef.current = false
      setRunning(false)
      abortControllerRef.current = null
    }
  }, [selectedStrategy, selectedExchange, selectedSymbol, selectedTimeframe])

  const loadChartForTask = useCallback(async (task: BacktestTask) => {
    if (loadingChartRef.current) return

    loadingChartRef.current = true
    try {
      const candles = await api.candles.get({
        exchange: task.exchange,
        symbol: task.symbol,
        timeframe: task.timeframe,
      })
      const chartData: CandlestickData[] = candles.map((candle: Candle) => ({
        time: (candle.timestamp / 1000) as Time,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
      setChartData(chartData)
      setLoadedChartTaskId(task.id)
    } catch (error) {
      console.error('Failed to load chart data:', error)
    } finally {
      loadingChartRef.current = false
    }
  }, [])

  useEffect(() => {
    const completedTasks = tasks.filter(task => task.status === 'completed' && task.statistic)
    if (completedTasks.length > 0) {
      const latestTask = completedTasks[completedTasks.length - 1]
      if (latestTask.statistic && !selectedTaskId) {
        setSelectedTaskId(latestTask.id)
      }
    }
  }, [tasks, selectedTaskId])

  useEffect(() => {
    if (selectedTaskId && selectedTaskId !== loadedChartTaskId && !loadingChartRef.current) {
      const task = tasks.find(t => t.id === selectedTaskId)
      if (task && task.status === 'completed' && task.statistic) {
        const markers = convertTradesToMarkers(task.statistic.trades)
        setTradeMarkers(markers)
        loadChartForTask(task)
      }
    }
  }, [selectedTaskId, loadedChartTaskId, loadChartForTask])

  const handleTaskClick = (task: BacktestTask) => {
    if (task.status === 'completed' && task.statistic) {
      setSelectedTaskId(task.id)
      setShowResultView(true)
    }
  }

  const getTaskStatusIcon = (task: BacktestTask) => {
    switch (task.status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-gray-400" />
      case 'running':
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
    }
  }

  const canRunBacktest = selectedStrategy && selectedSymbol && selectedTimeframe && !running

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-medium text-gray-900 mb-2">Backtest</h1>
            <p className="text-gray-500">Test your trading strategies against historical data</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
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

            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Backtest Tasks</h2>
                  <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-600' : 'text-gray-400'}`}>
                    <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                    {connected ? 'Connected' : 'Disconnected'}
                  </div>
                </div>

                <div className="space-y-3">
                  {tasks.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">
                      No backtest tasks yet
                    </p>
                  ) : (
                    tasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        className={`w-full text-left p-3 border rounded-lg transition-colors ${selectedTaskId === task.id
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                          } ${task.status === 'completed' ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {task.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {task.symbol} · {task.exchange} · {task.timeframe}
                            </p>
                          </div>
                          {getTaskStatusIcon(task)}
                        </div>

                        {task.status === 'running' && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Progress</span>
                              <span>{Math.round(task.progress)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {task.status === 'completed' && task.statistic && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Net Profit</span>
                              <span className={`font-medium ${Number(task.statistic.net_profit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {Number(task.statistic.net_profit).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Return</span>
                              <span className={`font-medium ${task.statistic.return_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {task.statistic.return_percent >= 0 ? '+' : ''}{task.statistic.return_percent.toFixed(2)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Win Rate</span>
                              <span className="font-medium text-gray-900">{task.statistic.win_rate.toFixed(2)}%</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs mt-2">
                              <div className="flex items-center gap-1 text-green-600">
                                <TrendingUp className="w-3 h-3" />
                                <span>{task.statistic.winning_trades} Win</span>
                              </div>
                              <div className="flex items-center gap-1 text-red-600">
                                <TrendingDown className="w-3 h-3" />
                                <span>{task.statistic.losing_trades} Loss</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {task.status === 'failed' && task.error_message && (
                          <div className="mt-2">
                            <p className="text-xs text-red-600">{task.error_message}</p>
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showResultView && selectedTaskId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Backtest Result</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {tasks.find(t => t.id === selectedTaskId)?.name} · {tasks.find(t => t.id === selectedTaskId)?.symbol}
                </p>
              </div>
              <button
                onClick={() => setShowResultView(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {chartData.length > 0 && (
                <div className="mb-6">
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Chart</h3>
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                      <CandlestickChart data={chartData} markers={tradeMarkers} />
                    </div>
                  </div>
                </div>
              )}

              {(() => {
                const task = tasks.find(t => t.id === selectedTaskId)
                return task?.statistic && (
                  <BacktestResult
                    statistic={task.statistic}
                    precision={task.precision}
                  />
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
