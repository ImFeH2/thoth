import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, type HistogramData, type IChartApi, type ISeriesApi, type CandlestickData, type LineData, type MouseEventHandler, type MouseEventParams, type SeriesMarker, type Time, type ISeriesMarkersPluginApi } from 'lightweight-charts'
import { BrushCleaning, Loader2, Maximize2, Minimize2, Minus, MousePointer2, Plus, RotateCcw, Square, Trash2, TrendingUp, type LucideIcon } from 'lucide-react'
import { ChartDrawingPrimitive, createDrawingId, getDrawingLabel, type ChartDrawing, type DraftDrawing, type DrawingPoint, type DrawingTool } from '@/components/chartDrawings'
import { formatChartTime } from '@/utils/time'
import type { Timeframe } from '@/types'

interface CandlestickChartProps {
  data: CandlestickData[]
  volumeData?: HistogramData<Time>[]
  symbol?: string
  frameless?: boolean
  className?: string
  surfaceClassName?: string
  markers?: SeriesMarker<Time>[]
  markerDetails?: ChartMarkerDetail[]
  loading?: boolean
  timeframeOptions?: Timeframe[]
  activeTimeframe?: Timeframe | ''
  onTimeframeChange?: (timeframe: Timeframe) => void
  controls?: ReactNode
}

export interface ChartMarkerDetail {
  id: string
  title: string
  accentColor: string
  fields: Array<{
    label: string
    value: string
  }>
}

const indicatorConfigs = [
  {
    id: 'ma20',
    label: 'MA 20',
    period: 20,
    mode: 'simple',
    color: '#f59e0b',
    activeClassName: 'border-amber-300 bg-amber-50 text-amber-700',
  },
  {
    id: 'ma50',
    label: 'MA 50',
    period: 50,
    mode: 'simple',
    color: '#f97316',
    activeClassName: 'border-orange-300 bg-orange-50 text-orange-700',
  },
  {
    id: 'ema20',
    label: 'EMA 20',
    period: 20,
    mode: 'exponential',
    color: '#3b82f6',
    activeClassName: 'border-blue-300 bg-blue-50 text-blue-700',
  },
  {
    id: 'ema50',
    label: 'EMA 50',
    period: 50,
    mode: 'exponential',
    color: '#8b5cf6',
    activeClassName: 'border-violet-300 bg-violet-50 text-violet-700',
  },
] as const

type IndicatorId = (typeof indicatorConfigs)[number]['id']
type DraftableDrawingTool = Exclude<DrawingTool, 'select' | 'horizontalLine'>

const drawingToolConfigs = [
  {
    id: 'select',
    label: 'Pointer',
    icon: MousePointer2,
    activeClassName: 'border-gray-900 bg-gray-900 text-white',
  },
  {
    id: 'trendLine',
    label: 'Trend Line',
    icon: TrendingUp,
    activeClassName: 'border-blue-300 bg-blue-50 text-blue-700',
  },
  {
    id: 'horizontalLine',
    label: 'Horizontal Line',
    icon: Minus,
    activeClassName: 'border-orange-300 bg-orange-50 text-orange-700',
  },
  {
    id: 'range',
    label: 'Range Box',
    icon: Square,
    activeClassName: 'border-teal-300 bg-teal-50 text-teal-700',
  },
] as const satisfies ReadonlyArray<{
  id: DrawingTool
  label: string
  icon: LucideIcon
  activeClassName: string
}>

function buildMovingAverageData(
  data: CandlestickData[],
  period: number,
  mode: 'simple' | 'exponential'
): LineData<Time>[] {
  if (!Number.isFinite(period) || period <= 0 || data.length < period) {
    return []
  }

  const closes = data.map((item) => item.close)
  const result: LineData<Time>[] = []

  if (mode === 'simple') {
    let rollingSum = closes.slice(0, period).reduce((sum, value) => sum + value, 0)
    result.push({
      time: data[period - 1].time,
      value: rollingSum / period,
    })

    for (let index = period; index < closes.length; index += 1) {
      rollingSum += closes[index] - closes[index - period]
      result.push({
        time: data[index].time,
        value: rollingSum / period,
      })
    }

    return result
  }

  const multiplier = 2 / (period + 1)
  let previous = closes.slice(0, period).reduce((sum, value) => sum + value, 0) / period

  result.push({
    time: data[period - 1].time,
    value: previous,
  })

  for (let index = period; index < closes.length; index += 1) {
    previous = (closes[index] - previous) * multiplier + previous
    result.push({
      time: data[index].time,
      value: previous,
    })
  }

  return result
}

export default function CandlestickChart({
  data,
  volumeData = [],
  symbol,
  frameless = false,
  className = '',
  surfaceClassName,
  markers,
  markerDetails = [],
  loading = false,
  timeframeOptions = [],
  activeTimeframe = '',
  onTimeframeChange,
  controls,
}: CandlestickChartProps) {
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartSurfaceRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const indicatorSeriesRef = useRef(new Map<IndicatorId, ISeriesApi<'Line'>>())
  const drawingPrimitiveRef = useRef(new ChartDrawingPrimitive())
  const drawingsRef = useRef<ChartDrawing[]>([])
  const selectedDrawingIdRef = useRef<string | null>(null)
  const draftDrawingRef = useRef<DraftDrawing | null>(null)
  const activeDrawingToolRef = useRef<DrawingTool>('select')
  const markerDetailsRef = useRef(markerDetails)
  const [enabledIndicators, setEnabledIndicators] = useState<IndicatorId[]>([])
  const [showVolume, setShowVolume] = useState(true)
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>('select')
  const [drawings, setDrawings] = useState<ChartDrawing[]>([])
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [draftKind, setDraftKind] = useState<DraftableDrawingTool | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false)
  const [markerTooltip, setMarkerTooltip] = useState<{
    detail: ChartMarkerDetail
    left: number
    top: number
  } | null>(null)

  const syncDrawingPrimitive = useCallback((
    nextDrawings: ChartDrawing[] = drawingsRef.current,
    nextSelectedDrawingId: string | null = selectedDrawingIdRef.current,
    nextDraftDrawing: DraftDrawing | null = draftDrawingRef.current
  ) => {
    drawingPrimitiveRef.current.setState(nextDrawings, nextSelectedDrawingId, nextDraftDrawing)
  }, [])

  const updateDrawings = useCallback((
    nextDrawings: ChartDrawing[] | ((previous: ChartDrawing[]) => ChartDrawing[])
  ) => {
    const resolvedDrawings = typeof nextDrawings === 'function'
      ? nextDrawings(drawingsRef.current)
      : nextDrawings

    drawingsRef.current = resolvedDrawings
    setDrawings(resolvedDrawings)
    syncDrawingPrimitive(resolvedDrawings)

    return resolvedDrawings
  }, [syncDrawingPrimitive])

  const updateSelectedDrawingId = useCallback((nextSelectedDrawingId: string | null) => {
    selectedDrawingIdRef.current = nextSelectedDrawingId
    setSelectedDrawingId(nextSelectedDrawingId)
    syncDrawingPrimitive(drawingsRef.current, nextSelectedDrawingId)
  }, [syncDrawingPrimitive])

  const clearDraftDrawing = useCallback(() => {
    draftDrawingRef.current = null
    setDraftKind(null)
    syncDrawingPrimitive(drawingsRef.current, selectedDrawingIdRef.current, null)
  }, [syncDrawingPrimitive])

  const beginDraftDrawing = useCallback((tool: DraftableDrawingTool, point: DrawingPoint) => {
    const nextDraftDrawing: DraftDrawing = {
      id: createDrawingId(tool),
      kind: tool,
      start: point,
      end: point,
    }

    draftDrawingRef.current = nextDraftDrawing
    setDraftKind(tool)
    syncDrawingPrimitive(drawingsRef.current, selectedDrawingIdRef.current, nextDraftDrawing)
  }, [syncDrawingPrimitive])

  const updateDraftDrawingPreview = useCallback((point: DrawingPoint) => {
    const currentDraftDrawing = draftDrawingRef.current

    if (!currentDraftDrawing) {
      return
    }

    const nextDraftDrawing: DraftDrawing = {
      ...currentDraftDrawing,
      end: point,
    }

    draftDrawingRef.current = nextDraftDrawing
    syncDrawingPrimitive(drawingsRef.current, selectedDrawingIdRef.current, nextDraftDrawing)
  }, [syncDrawingPrimitive])

  const finalizeDraftDrawing = useCallback((point: DrawingPoint) => {
    const currentDraftDrawing = draftDrawingRef.current

    if (!currentDraftDrawing) {
      return
    }

    const completedDrawing: ChartDrawing = {
      ...currentDraftDrawing,
      end: point,
    }

    const nextDrawings = [...drawingsRef.current, completedDrawing]
    drawingsRef.current = nextDrawings
    setDrawings(nextDrawings)
    selectedDrawingIdRef.current = completedDrawing.id
    setSelectedDrawingId(completedDrawing.id)
    draftDrawingRef.current = null
    setDraftKind(null)
    syncDrawingPrimitive(nextDrawings, completedDrawing.id, null)
  }, [syncDrawingPrimitive])

  const removeSelectedDrawing = useCallback(() => {
    const currentSelectedDrawingId = selectedDrawingIdRef.current

    if (!currentSelectedDrawingId) {
      return
    }

    const nextDrawings = drawingsRef.current.filter((drawing) => drawing.id !== currentSelectedDrawingId)
    drawingsRef.current = nextDrawings
    setDrawings(nextDrawings)
    selectedDrawingIdRef.current = null
    setSelectedDrawingId(null)
    syncDrawingPrimitive(nextDrawings, null)
  }, [syncDrawingPrimitive])

  const clearDrawings = useCallback(() => {
    drawingsRef.current = []
    setDrawings([])
    selectedDrawingIdRef.current = null
    setSelectedDrawingId(null)
    draftDrawingRef.current = null
    setDraftKind(null)
    syncDrawingPrimitive([], null, null)
  }, [syncDrawingPrimitive])

  const getDrawingPoint = useCallback((param: MouseEventParams<Time>) => {
    const chart = chartRef.current
    const series = seriesRef.current

    if (!chart || !series || !param.point) {
      return null
    }

    const time = param.time ?? chart.timeScale().coordinateToTime(param.point.x)
    const price = series.coordinateToPrice(param.point.y)

    if (time == null || price == null) {
      return null
    }

    return {
      time,
      price,
    } satisfies DrawingPoint
  }, [])

  const toggleIndicator = useCallback((indicatorId: IndicatorId) => {
    setEnabledIndicators((prev) =>
      prev.includes(indicatorId)
        ? prev.filter((item) => item !== indicatorId)
        : [...prev, indicatorId]
    )
  }, [])

  const adjustZoom = useCallback((factor: number) => {
    const chart = chartRef.current
    if (!chart) {
      return
    }

    const timeScale = chart.timeScale()
    const range = timeScale.getVisibleLogicalRange()

    if (!range) {
      timeScale.fitContent()
      return
    }

    const center = (range.from + range.to) / 2
    const nextSpan = Math.max(10, (range.to - range.from) * factor)

    timeScale.setVisibleLogicalRange({
      from: center - nextSpan / 2,
      to: center + nextSpan / 2,
    })
  }, [])

  const resetView = useCallback(() => {
    chartRef.current?.timeScale().fitContent()
  }, [])

  const syncChartSize = useCallback(() => {
    if (!chartRef.current || !chartContainerRef.current || !chartSurfaceRef.current) {
      return
    }

    chartRef.current.applyOptions({
      width: chartContainerRef.current.clientWidth,
      height: Math.max(320, chartSurfaceRef.current.clientHeight),
    })
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const container = fullscreenContainerRef.current

    if (!container || !document.fullscreenEnabled) {
      return
    }

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen()
        return
      }

      await container.requestFullscreen()
    } catch (error) {
      console.error('Failed to toggle fullscreen chart:', error)
    }
  }, [])

  useEffect(() => {
    markerDetailsRef.current = markerDetails
  }, [markerDetails])

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool

    if (activeDrawingTool !== 'select' && selectedDrawingIdRef.current) {
      updateSelectedDrawingId(null)
    }

    const currentDraftDrawing = draftDrawingRef.current
    if (currentDraftDrawing && currentDraftDrawing.kind !== activeDrawingTool) {
      clearDraftDrawing()
    }
  }, [activeDrawingTool, clearDraftDrawing, updateSelectedDrawingId])

  useEffect(() => {
    clearDrawings()
    setActiveDrawingTool('select')
    setMarkerTooltip(null)
  }, [clearDrawings, symbol])

  useEffect(() => {
    const container = fullscreenContainerRef.current

    setIsFullscreenSupported(
      Boolean(container && document.fullscreenEnabled && typeof container.requestFullscreen === 'function')
    )

    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === container)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      syncChartSize()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [isFullscreen, syncChartSize])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      width: chartContainerRef.current.clientWidth,
      height: Math.max(320, chartSurfaceRef.current?.clientHeight ?? 500),
      localization: {
        timeFormatter: (timestamp: number) => formatChartTime(timestamp),
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#e0e0e0',
      },
      rightPriceScale: {
        borderColor: '#e0e0e0',
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#9B7DFF',
          width: 1,
          style: 2,
          labelBackgroundColor: '#9B7DFF',
        },
        horzLine: {
          color: '#9B7DFF',
          width: 1,
          style: 2,
          labelBackgroundColor: '#9B7DFF',
        },
      },
    })

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    })

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    })

    const drawingPrimitive = drawingPrimitiveRef.current

    chartRef.current = chart
    seriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries
    markersRef.current = createSeriesMarkers(candlestickSeries, [])
    candlestickSeries.attachPrimitive(drawingPrimitive)
    syncDrawingPrimitive()
    const indicatorSeries = indicatorSeriesRef.current

    const handleResize = () => {
      syncChartSize()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      indicatorSeries.clear()
      candlestickSeries.detachPrimitive(drawingPrimitive)
      chart.remove()
    }
  }, [syncChartSize, syncDrawingPrimitive])

  useEffect(() => {
    if (!seriesRef.current) {
      return
    }

    seriesRef.current.setData(data)

    if (chartRef.current && data.length > 0) {
      chartRef.current.timeScale().fitContent()
    }
  }, [data])

  useEffect(() => {
    if (!volumeSeriesRef.current) {
      return
    }

    if (showVolume && volumeData.length > 0) {
      volumeSeriesRef.current.applyOptions({
        visible: true,
      })
      volumeSeriesRef.current.setData(volumeData)
      return
    }

    volumeSeriesRef.current.applyOptions({
      visible: false,
    })
    volumeSeriesRef.current.setData([])
  }, [showVolume, volumeData])

  useEffect(() => {
    if (seriesRef.current) {
      const nextMarkers = markers ?? []

      if (markersRef.current) {
        markersRef.current.setMarkers(nextMarkers)
      } else {
        markersRef.current = createSeriesMarkers(seriesRef.current, nextMarkers)
      }
    }
  }, [markers])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      return
    }

    const handleCrosshairMove: MouseEventHandler<Time> = (param) => {
      if (!param.point || typeof param.hoveredObjectId !== 'string') {
        setMarkerTooltip(null)
      } else {
        const detail = markerDetailsRef.current.find((markerDetail) => markerDetail.id === param.hoveredObjectId)

        if (!detail) {
          setMarkerTooltip(null)
        } else {
          const surface = chartSurfaceRef.current
          const tooltipWidth = 248
          const tooltipHeight = 52 + detail.fields.length * 26
          const surfaceWidth = surface?.clientWidth ?? 0
          const surfaceHeight = surface?.clientHeight ?? 0

          const left = surfaceWidth > 0
            ? Math.min(Math.max(12, param.point.x + 16), Math.max(12, surfaceWidth - tooltipWidth - 12))
            : param.point.x + 16

          const top = surfaceHeight > 0
            ? Math.min(Math.max(12, param.point.y - tooltipHeight - 12), Math.max(12, surfaceHeight - tooltipHeight - 12))
            : Math.max(12, param.point.y - tooltipHeight - 12)

          setMarkerTooltip({
            detail,
            left,
            top,
          })
        }
      }

      if (!draftDrawingRef.current) {
        return
      }

      const nextPoint = getDrawingPoint(param)
      if (!nextPoint) {
        return
      }

      updateDraftDrawingPreview(nextPoint)
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
    }
  }, [getDrawingPoint, updateDraftDrawingPreview])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      return
    }

    const handleClick: MouseEventHandler<Time> = (param) => {
      const currentTool = activeDrawingToolRef.current

      if (currentTool === 'select') {
        if (typeof param.hoveredObjectId === 'string' && param.hoveredObjectId.startsWith('drawing:')) {
          updateSelectedDrawingId(param.hoveredObjectId)
          return
        }

        updateSelectedDrawingId(null)
        return
      }

      const point = getDrawingPoint(param)
      if (!point) {
        return
      }

      if (currentTool === 'horizontalLine') {
        const horizontalLineDrawing: ChartDrawing = {
          id: createDrawingId('horizontalLine'),
          kind: 'horizontalLine',
          price: point.price,
        }

        const nextDrawings = updateDrawings((previousDrawings) => [...previousDrawings, horizontalLineDrawing])
        updateSelectedDrawingId(horizontalLineDrawing.id)
        syncDrawingPrimitive(nextDrawings, horizontalLineDrawing.id, null)
        return
      }

      const currentDraftDrawing = draftDrawingRef.current

      if (!currentDraftDrawing || currentDraftDrawing.kind !== currentTool) {
        beginDraftDrawing(currentTool, point)
        return
      }

      finalizeDraftDrawing(point)
    }

    chart.subscribeClick(handleClick)

    return () => {
      chart.unsubscribeClick(handleClick)
    }
  }, [
    beginDraftDrawing,
    finalizeDraftDrawing,
    getDrawingPoint,
    syncDrawingPrimitive,
    updateDrawings,
    updateSelectedDrawingId,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target

      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (event.key === 'Escape') {
        if (document.fullscreenElement === fullscreenContainerRef.current) {
          return
        }

        if (draftDrawingRef.current) {
          event.preventDefault()
          clearDraftDrawing()
          return
        }

        if (activeDrawingToolRef.current !== 'select') {
          event.preventDefault()
          setActiveDrawingTool('select')
        }

        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawingIdRef.current) {
        event.preventDefault()
        removeSelectedDrawing()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [clearDraftDrawing, removeSelectedDrawing])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      return
    }

    indicatorConfigs.forEach((config) => {
      const existingSeries = indicatorSeriesRef.current.get(config.id)
      const isEnabled = enabledIndicators.includes(config.id)

      if (!isEnabled) {
        if (existingSeries) {
          chart.removeSeries(existingSeries)
          indicatorSeriesRef.current.delete(config.id)
        }
        return
      }

      const indicatorData = buildMovingAverageData(data, config.period, config.mode)

      if (!existingSeries) {
        const nextSeries = chart.addSeries(LineSeries, {
          color: config.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        nextSeries.setData(indicatorData)
        indicatorSeriesRef.current.set(config.id, nextSeries)
        return
      }

      existingSeries.setData(indicatorData)
    })
  }, [data, enabledIndicators])

  const selectedDrawing = selectedDrawingId
    ? drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null
    : null

  const drawingStatus = activeDrawingTool === 'select'
    ? selectedDrawing
      ? `${getDrawingLabel(selectedDrawing.kind)} selected`
      : null
    : activeDrawingTool === 'horizontalLine'
      ? 'Click anywhere on the chart to place a horizontal line'
      : draftKind === activeDrawingTool
        ? `Click the second point to finish the ${getDrawingLabel(activeDrawingTool).toLowerCase()}`
        : `Click the first point to start the ${getDrawingLabel(activeDrawingTool).toLowerCase()}`

  const drawingShortcutHint = activeDrawingTool === 'select'
    ? selectedDrawing
      ? 'Delete to remove the selected drawing'
      : null
    : draftKind
      ? 'Esc to cancel'
      : 'Esc to return to pointer'

  return (
    <div
      ref={fullscreenContainerRef}
      className={`bg-white p-6 overflow-hidden flex flex-col ${isFullscreen
        ? 'h-full w-full rounded-none border-0 p-4 sm:p-6'
        : `${frameless ? '' : 'border border-gray-200 rounded-xl'} ${className}`
        }`}
    >
      {(symbol || controls || timeframeOptions.length > 1 || data.length > 0) && (
        <div className="flex flex-col gap-4 mb-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            {symbol && (
              <h2 className="text-sm font-medium text-gray-900 truncate">{symbol}</h2>
            )}

            {data.length > 0 && (
              <div className="flex flex-wrap items-center justify-start gap-2">
                {drawingToolConfigs.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setActiveDrawingTool((previousTool) => previousTool === tool.id ? 'select' : tool.id)}
                    title={tool.label}
                    aria-label={tool.label}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${activeDrawingTool === tool.id
                      ? tool.activeClassName
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                      }`}
                  >
                    <tool.icon className="h-4 w-4" />
                  </button>
                ))}

                <button
                  type="button"
                  onClick={removeSelectedDrawing}
                  disabled={!selectedDrawing}
                  title="Delete"
                  aria-label="Delete"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={clearDrawings}
                  disabled={drawings.length === 0}
                  title="Clear"
                  aria-label="Clear"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                >
                  <BrushCleaning className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            {timeframeOptions.length > 1 && onTimeframeChange && (
              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                {timeframeOptions.map((timeframe) => (
                  <button
                    key={timeframe}
                    type="button"
                    onClick={() => onTimeframeChange(timeframe)}
                    className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${activeTimeframe === timeframe
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                      }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            )}

            {data.length > 0 && (
              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                <button
                  type="button"
                  onClick={() => setShowVolume((prev) => !prev)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${showVolume
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                    }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Volume
                </button>
                <button
                  type="button"
                  onClick={() => adjustZoom(1.25)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                >
                  <Minus className="w-3.5 h-3.5" />
                  Zoom Out
                </button>
                <button
                  type="button"
                  onClick={() => adjustZoom(0.8)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Zoom In
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset View
                </button>
                {isFullscreenSupported && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
                    title={isFullscreen ? 'Exit Full Screen (Esc)' : 'Full Screen'}
                    aria-label={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-3.5 h-3.5" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" />
                    )}
                    {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                  </button>
                )}
              </div>
            )}

            {data.length > 0 && (
              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                {indicatorConfigs.map((indicator) => {
                  const isEnabled = enabledIndicators.includes(indicator.id)

                  return (
                    <button
                      key={indicator.id}
                      type="button"
                      onClick={() => toggleIndicator(indicator.id)}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${isEnabled
                        ? indicator.activeClassName
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                        }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: indicator.color }}
                      />
                      {indicator.label}
                    </button>
                  )
                })}
              </div>
            )}

            {controls && (
              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                {controls}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        ref={chartSurfaceRef}
        className={`relative ${isFullscreen ? 'min-h-[420px] flex-1' : surfaceClassName ?? 'h-[500px]'} ${activeDrawingTool === 'select' ? '' : 'cursor-crosshair'}`}
      >
        <div ref={chartContainerRef} className="w-full h-full" />

        {(drawingStatus || drawingShortcutHint) && data.length > 0 && (
          <div className="absolute left-4 top-4 z-10 pointer-events-none">
            <div className="rounded-2xl border border-gray-200 bg-white/92 px-4 py-3 shadow-sm backdrop-blur-sm">
              {drawingStatus && (
                <div className="text-sm font-medium text-gray-900">
                  {drawingStatus}
                </div>
              )}
              {drawingShortcutHint && (
                <div className="mt-1 text-xs text-gray-500">
                  {drawingShortcutHint}
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/85 backdrop-blur-sm rounded-lg">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading chart
            </div>
          </div>
        )}

        {markerTooltip && (
          <div
            className="absolute z-20 w-[248px] max-w-[248px] pointer-events-none rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm"
            style={{
              left: `${markerTooltip.left}px`,
              top: `${markerTooltip.top}px`,
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: markerTooltip.detail.accentColor }}
              />
              <span className="text-sm font-semibold text-gray-900">
                {markerTooltip.detail.title}
              </span>
            </div>

            <div className="space-y-2">
              {markerTooltip.detail.fields.map((field) => (
                <div key={`${markerTooltip.detail.id}-${field.label}`} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-gray-500">{field.label}</span>
                  <span className="text-xs font-medium text-gray-900 text-right break-all">
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.length === 0 && !loading && (
        <div className="mt-4 flex items-center justify-center text-sm text-gray-500">
          No chart data available
        </div>
      )}
    </div>
  )
}
