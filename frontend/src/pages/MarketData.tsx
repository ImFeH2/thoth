import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { TIMEFRAME_OPTIONS, useAppSettings } from '@/lib/appSettings'
import { api } from '@/services/api'
import CandlestickChart from '@/components/CandlestickChart'
import type { Timeframe, AvailableCandleInfo, Candle } from '@/types'
import type { CandlestickData, HistogramData, Time } from 'lightweight-charts'

export default function MarketData() {
  const settings = useAppSettings()
  const [availableData, setAvailableData] = useState<AvailableCandleInfo[]>([])
  const [chartData, setChartData] = useState<CandlestickData[]>([])
  const [volumeData, setVolumeData] = useState<HistogramData<Time>[]>([])
  const [loadingAvailableData, setLoadingAvailableData] = useState(true)
  const [loadingChart, setLoadingChart] = useState(false)
  const [selectedData, setSelectedData] = useState<AvailableCandleInfo | null>(null)

  const loadChartData = useCallback(async (info: AvailableCandleInfo) => {
    try {
      setLoadingChart(true)
      setSelectedData(info)
      setChartData([])
      setVolumeData([])
      const candles = await api.candles.get({
        exchange: info.exchange,
        symbol: info.symbol,
        timeframe: info.timeframe,
      })

      const formattedData: CandlestickData[] = candles.map((candle: Candle) => ({
        time: (candle.timestamp / 1000) as Time,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
      }))

      const formattedVolume: HistogramData<Time>[] = candles.map((candle: Candle) => {
        const open = parseFloat(candle.open)
        const close = parseFloat(candle.close)

        return {
          time: (candle.timestamp / 1000) as Time,
          value: parseFloat(candle.volume),
          color: close >= open ? '#86efac' : '#fca5a5',
        }
      })

      setChartData(formattedData)
      setVolumeData(formattedVolume)
    } catch (error) {
      console.error('Failed to load chart data:', error)
    } finally {
      setLoadingChart(false)
    }
  }, [])

  const loadAvailableData = useCallback(async () => {
    try {
      setLoadingAvailableData(true)
      const data = await api.candles.available()
      setAvailableData(data)
      if (data.length > 0 && !selectedData) {
        const preferredData = data.find((item) =>
          item.exchange === settings.defaults.exchange
          && item.symbol === settings.defaults.symbol
          && item.timeframe === settings.defaults.timeframe
        ) ?? data[0]
        loadChartData(preferredData)
      }
    } catch (error) {
      console.error('Failed to load available data:', error)
    } finally {
      setLoadingAvailableData(false)
    }
  }, [loadChartData, selectedData, settings.defaults.exchange, settings.defaults.symbol, settings.defaults.timeframe])

  useEffect(() => {
    loadAvailableData()
  }, [loadAvailableData])

  const chartTimeframes = selectedData
    ? TIMEFRAME_OPTIONS.filter((timeframe) =>
      availableData.some((info) =>
        info.exchange === selectedData.exchange
        && info.symbol === selectedData.symbol
        && info.timeframe === timeframe
      )
    )
    : []

  const handleChartTimeframeChange = useCallback((timeframe: Timeframe) => {
    if (!selectedData || timeframe === selectedData.timeframe) {
      return
    }

    const nextData = availableData.find((info) =>
      info.exchange === selectedData.exchange
      && info.symbol === selectedData.symbol
      && info.timeframe === timeframe
    )

    if (nextData) {
      loadChartData(nextData)
    }
  }, [availableData, loadChartData, selectedData])

  return (
    <div className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="flex min-h-full flex-col lg:h-full lg:min-h-0 lg:flex-row">
        <aside className="shrink-0 border-b border-gray-200 bg-white lg:w-80 lg:border-b-0 lg:border-r">
          <div className="flex h-full min-h-0 flex-col p-4">
            <h2 className="mb-4 text-sm font-medium text-gray-900">Available Data</h2>
            <div className="max-h-72 min-h-0 overflow-y-auto lg:max-h-none lg:flex-1">
              {loadingAvailableData ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="w-5 h-5 text-gray-400 animate-spin mb-3" />
                  <p className="text-sm text-gray-500">Loading data...</p>
                </div>
              ) : availableData.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">No data available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableData.map((info) => (
                    <button
                      key={`${info.exchange}-${info.symbol}-${info.timeframe}`}
                      onClick={() => loadChartData(info)}
                      className={`w-full p-3 border rounded-lg text-left transition-colors ${selectedData?.exchange === info.exchange &&
                        selectedData?.symbol === info.symbol &&
                        selectedData?.timeframe === info.timeframe
                        ? 'border-gray-900 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {info.symbol}
                      </p>
                      <p className="text-xs text-gray-500">
                        {info.exchange} · {info.timeframe}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {Number(info.count).toLocaleString()} candles
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="min-h-[540px] min-w-0 flex-1 lg:min-h-0">
          {selectedData ? (
            <CandlestickChart
              data={chartData}
              volumeData={volumeData}
              symbol={`${selectedData.symbol} (${selectedData.exchange} - ${selectedData.timeframe})`}
              loading={loadingChart}
              timeframeOptions={chartTimeframes}
              activeTimeframe={selectedData.timeframe}
              onTimeframeChange={handleChartTimeframeChange}
              frameless
              className="h-full"
              surfaceClassName="min-h-[420px] flex-1"
            />
          ) : (
            <div className="flex h-full flex-col bg-white p-6">
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                {loadingAvailableData ? (
                  <>
                    <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-3" />
                    <p className="text-sm font-medium text-gray-900 mb-1">Loading Market Data</p>
                    <p className="text-sm text-gray-500">Preparing available data</p>
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-900 mb-1">No Data Available</p>
                    <p className="text-sm text-gray-500">Use Download to add market data</p>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
