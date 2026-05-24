import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CheckCircle, Clock, Loader, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import CandlestickChart, { type ChartMarkerDetail } from '@/components/CandlestickChart'
import BacktestResult from '@/components/BacktestResult'
import { api } from '@/services/api'
import { useBacktestStream } from '@/hooks/useBacktestStream'
import type { BacktestTask, Candle, Trade } from '@/types'
import type { CandlestickData, HistogramData, SeriesMarker, Time } from 'lightweight-charts'
import { formatTimestamp } from '@/utils/time'

export default function Tasks() {
  const { tasks, connected } = useBacktestStream()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const selectedTaskIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)

  const [tradeMarkers, setTradeMarkers] = useState<SeriesMarker<Time>[]>([])
  const [tradeMarkerDetails, setTradeMarkerDetails] = useState<ChartMarkerDetail[]>([])
  const [chartData, setChartData] = useState<CandlestickData[]>([])
  const [volumeData, setVolumeData] = useState<HistogramData<Time>[]>([])
  const [loadedChartTaskId, setLoadedChartTaskId] = useState<string | null>(null)
  const [loadingChart, setLoadingChart] = useState(false)

  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.created_at - left.created_at),
    [tasks]
  )

  const selectedTask = selectedTaskId
    ? sortedTasks.find((task) => task.id === selectedTaskId) ?? null
    : null

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId
  }, [selectedTaskId])

  useEffect(() => {
    if (sortedTasks.length === 0) {
      setSelectedTaskId(null)
      return
    }

    if (!selectedTaskId || !sortedTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(sortedTasks[0].id)
    }
  }, [selectedTaskId, sortedTasks])

  const convertTradesToMarkers = useCallback((trades: Trade[]) => {
    const markers: SeriesMarker<Time>[] = []
    const details: ChartMarkerDetail[] = []

    trades.forEach((trade, index) => {
      const isBuy = trade.trade_type === 'market_buy' || trade.trade_type === 'limit_buy'
      const isLimit = trade.trade_type === 'limit_buy' || trade.trade_type === 'limit_sell'
      const markerId = `${trade.timestamp}-${trade.trade_type}-${index}`

      markers.push({
        id: markerId,
        time: (trade.timestamp / 1000) as Time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#26a69a' : '#ef5350',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${isLimit ? 'LIMIT' : 'MARKET'} ${isBuy ? 'BUY' : 'SELL'} ${trade.amount} @ ${trade.price}`,
      })

      const profitValue = trade.profit ? Number(trade.profit) : null

      details.push({
        id: markerId,
        title: `${isLimit ? 'Limit' : 'Market'} ${isBuy ? 'Buy' : 'Sell'}`,
        accentColor: isBuy ? '#26a69a' : '#ef5350',
        fields: [
          { label: 'Time', value: formatTimestamp(trade.timestamp) },
          { label: 'Price', value: trade.price },
          { label: 'Amount', value: trade.amount },
          { label: 'Fee', value: trade.fee },
          {
            label: 'Profit',
            value: profitValue === null || Number.isNaN(profitValue)
              ? 'N/A'
              : profitValue.toFixed(2),
          },
        ],
      })
    })

    return {
      markers,
      details,
    }
  }, [])

  const clearChartState = useCallback(() => {
    loadRequestIdRef.current += 1
    setChartData([])
    setVolumeData([])
    setTradeMarkers([])
    setTradeMarkerDetails([])
    setLoadedChartTaskId(null)
    setLoadingChart(false)
  }, [])

  const loadChartForTask = useCallback(async (task: BacktestTask) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoadingChart(true)

    try {
      const candles = await api.candles.get({
        exchange: task.exchange,
        symbol: task.symbol,
        timeframe: task.timeframe,
      })
      const nextChartData: CandlestickData[] = candles.map((candle: Candle) => ({
        time: (candle.timestamp / 1000) as Time,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
      const nextVolumeData: HistogramData<Time>[] = candles.map((candle: Candle) => {
        const open = Number(candle.open)
        const close = Number(candle.close)

        return {
          time: (candle.timestamp / 1000) as Time,
          value: Number(candle.volume),
          color: close >= open ? '#86efac' : '#fca5a5',
        }
      })

      if (requestId !== loadRequestIdRef.current || selectedTaskIdRef.current !== task.id) {
        return
      }

      setChartData(nextChartData)
      setVolumeData(nextVolumeData)
      setLoadedChartTaskId(task.id)
    } catch (error) {
      console.error('Failed to load chart data:', error)
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoadingChart(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'completed' || !selectedTask.statistic) {
      clearChartState()
      return
    }

    const markerData = convertTradesToMarkers(selectedTask.statistic.trades)
    setTradeMarkers(markerData.markers)
    setTradeMarkerDetails(markerData.details)

    if (selectedTask.id !== loadedChartTaskId) {
      setChartData([])
      setVolumeData([])
      loadChartForTask(selectedTask)
    }
  }, [clearChartState, convertTradesToMarkers, loadChartForTask, loadedChartTaskId, selectedTask])

  return (
    <div className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="flex min-h-full flex-col lg:h-full lg:min-h-0 lg:flex-row">
        <aside className="shrink-0 border-b border-gray-200 bg-white lg:w-80 lg:border-b-0 lg:border-r">
          <div className="flex h-full min-h-0 flex-col p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-900">Tasks</h2>
              <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-600' : 'text-gray-400'}`}>
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                {connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>

            <div className="max-h-72 min-h-0 overflow-y-auto lg:max-h-none lg:flex-1">
              {sortedTasks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">No tasks yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedTasks.map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      selected={selectedTaskId === task.id}
                      onSelect={() => setSelectedTaskId(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="min-h-[540px] min-w-0 flex-1 overflow-y-auto p-4 lg:min-h-0">
          <TaskDetails
            task={selectedTask}
            chartData={chartData}
            volumeData={volumeData}
            tradeMarkers={tradeMarkers}
            tradeMarkerDetails={tradeMarkerDetails}
            loadingChart={loadingChart}
          />
        </section>
      </div>
    </div>
  )
}

function TaskListItem({
  task,
  selected,
  onSelect,
}: {
  task: BacktestTask
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full p-3 border rounded-lg text-left transition-colors ${selected
        ? 'border-gray-900 bg-gray-50'
        : 'border-gray-200 hover:border-gray-300'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
        <TaskProgress progress={task.progress} compact />
      )}

      {task.status === 'completed' && task.statistic && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <MetricRow
            label="Net Profit"
            value={Number(task.statistic.net_profit).toFixed(2)}
            valueClassName={Number(task.statistic.net_profit) >= 0 ? 'text-green-600' : 'text-red-600'}
          />
          <MetricRow
            label="Return"
            value={`${task.statistic.return_percent >= 0 ? '+' : ''}${task.statistic.return_percent.toFixed(2)}%`}
            valueClassName={task.statistic.return_percent >= 0 ? 'text-green-600' : 'text-red-600'}
          />
          <MetricRow
            label="Win Rate"
            value={`${task.statistic.win_rate.toFixed(2)}%`}
          />
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
        <p className="mt-2 text-xs text-red-600">{task.error_message}</p>
      )}
    </button>
  )
}

function TaskDetails({
  task,
  chartData,
  volumeData,
  tradeMarkers,
  tradeMarkerDetails,
  loadingChart,
}: {
  task: BacktestTask | null
  chartData: CandlestickData[]
  volumeData: HistogramData<Time>[]
  tradeMarkers: SeriesMarker<Time>[]
  tradeMarkerDetails: ChartMarkerDetail[]
  loadingChart: boolean
}) {
  if (!task) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-6 text-center">
        <BarChart3 className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-900 mb-1">No Task Selected</p>
        <p className="text-sm text-gray-500">Choose a task to view details</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <TaskSummary task={task} />

      {task.status === 'completed' && task.statistic ? (
        <>
          <CandlestickChart
            data={chartData}
            volumeData={volumeData}
            symbol={`${task.symbol} (${task.exchange} - ${task.timeframe})`}
            markers={tradeMarkers}
            markerDetails={tradeMarkerDetails}
            loading={loadingChart}
          />

          <BacktestResult
            statistic={task.statistic}
            precision={task.precision}
          />
        </>
      ) : (
        <TaskStatusPanel task={task} />
      )}
    </div>
  )
}

function TaskSummary({ task }: { task: BacktestTask }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {getTaskStatusIcon(task)}
            <h2 className="text-xl font-semibold text-gray-900 truncate">{task.name}</h2>
          </div>
          <p className="text-sm text-gray-500">
            {task.symbol} · {task.exchange} · {task.timeframe}
          </p>
        </div>
        <StatusBadge task={task} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <DetailCell label="Created" value={formatTimestamp(task.created_at)} />
        <DetailCell label="Started" value={task.started_at ? formatTimestamp(task.started_at) : 'N/A'} />
        <DetailCell label="Completed" value={task.completed_at ? formatTimestamp(task.completed_at) : 'N/A'} />
      </div>
    </div>
  )
}

function TaskStatusPanel({ task }: { task: BacktestTask }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Task Status</h2>

      {task.status === 'pending' && (
        <p className="text-sm text-gray-500">Waiting to start</p>
      )}

      {task.status === 'compiling' && (
        <p className="text-sm text-yellow-600">Compiling strategy...</p>
      )}

      {task.status === 'running' && (
        <TaskProgress progress={task.progress} />
      )}

      {task.status === 'failed' && (
        <div>
          <p className="text-sm font-medium text-red-600 mb-2">Backtest failed</p>
          <p className="text-sm text-gray-600">{task.error_message ?? 'No error details available'}</p>
        </div>
      )}
    </div>
  )
}

function TaskProgress({ progress, compact = false }: { progress: number; compact?: boolean }) {
  return (
    <div className={compact ? 'mt-2' : ''}>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>Progress</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

function MetricRow({
  label,
  value,
  valueClassName = 'text-gray-900',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${valueClassName}`}>{value}</span>
    </div>
  )
}

function StatusBadge({ task }: { task: BacktestTask }) {
  const className = {
    pending: 'bg-gray-100 text-gray-600',
    compiling: 'bg-yellow-50 text-yellow-700',
    running: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
  }[task.status]

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${className}`}>
      {task.status}
    </span>
  )
}

function getTaskStatusIcon(task: BacktestTask) {
  switch (task.status) {
    case 'pending':
      return <Clock className="w-4 h-4 text-gray-400" />
    case 'compiling':
      return <Loader className="w-4 h-4 text-yellow-500 animate-spin" />
    case 'running':
      return <Loader className="w-4 h-4 text-blue-500 animate-spin" />
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-500" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />
  }
}
