import { useState } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart3, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatTimestamp } from '@/utils/time'
import type { BacktestStatistic, MarketPrecision } from '@/types'

interface BacktestResultProps {
  statistic: BacktestStatistic
  precision: MarketPrecision
}

const TRADES_PER_PAGE = 20

export default function BacktestResult({ statistic, precision }: BacktestResultProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const netProfitValue = Number(statistic.net_profit)
  const returnPercentValue = statistic.return_percent
  const isProfit = netProfitValue > 0

  const pricePrecision = Math.abs(Math.log10(Number(precision.price_precision)))
  const amountPrecision = Math.abs(Math.log10(Number(precision.amount_precision)))

  const formatNumber = (value: string | number | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    if (isNaN(num) || !isFinite(num)) return 'N/A'
    return num.toFixed(decimals)
  }

  const formatPrice = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    if (isNaN(num) || !isFinite(num)) return 'N/A'
    return num.toFixed(pricePrecision)
  }

  const formatAmount = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A'
    const num = typeof value === 'string' ? Number(value) : value
    if (isNaN(num) || !isFinite(num)) return 'N/A'
    return num.toFixed(amountPrecision)
  }

  const formatPercent = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A'
    if (isNaN(value) || !isFinite(value)) return 'N/A'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const StatCard = ({
    icon: Icon,
    label,
    value,
    valueColor = 'text-gray-900',
    subtitle
  }: {
    icon: any
    label: string
    value: string | number
    valueColor?: string
    subtitle?: string
  }) => (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <div className={`text-xl font-semibold ${valueColor}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Performance Summary</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className={`rounded-lg p-6 ${isProfit ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {isProfit ? (
                <ArrowUpRight className="w-5 h-5 text-green-600" />
              ) : (
                <ArrowDownRight className="w-5 h-5 text-red-600" />
              )}
              <span className="text-sm text-gray-600">Net Profit</span>
            </div>
            <div className={`text-3xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {formatNumber(statistic.net_profit)}
            </div>
            <div className={`text-sm mt-1 ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercent(returnPercentValue)}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-600">Capital</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Initial</span>
                <span className="text-sm font-medium text-gray-900">{formatNumber(statistic.initial_capital)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Peak</span>
                <span className="text-sm font-medium text-gray-900">{formatNumber(statistic.max_equity)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={TrendingDown}
            label="Max Drawdown"
            value={formatNumber(statistic.max_drawdown)}
            valueColor="text-red-600"
            subtitle={formatPercent(statistic.max_drawdown_percent)}
          />

          <StatCard
            icon={BarChart3}
            label="Profit Factor"
            value={formatNumber(statistic.profit_factor)}
            valueColor={statistic.profit_factor > 1 ? 'text-green-600' : 'text-red-600'}
          />

          <StatCard
            icon={Percent}
            label="Win Rate"
            value={formatPercent(statistic.win_rate)}
            valueColor={statistic.win_rate > 50 ? 'text-green-600' : 'text-gray-900'}
            subtitle={`${statistic.sell_trades} sells`}
          />

          <StatCard
            icon={BarChart3}
            label="Sharpe Ratio"
            value={formatNumber(statistic.sharpe_ratio)}
            valueColor={statistic.sharpe_ratio > 1 ? 'text-green-600' : statistic.sharpe_ratio > 0 ? 'text-gray-900' : 'text-red-600'}
          />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <div className="text-sm text-gray-600 mb-1">Total Orders</div>
            <div className="text-2xl font-semibold text-gray-900">{statistic.total_trades}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <div className="text-sm text-gray-600 mb-1">Buy Orders</div>
            <div className="text-2xl font-semibold text-green-600">{statistic.buy_trades}</div>
          </div>
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <div className="text-sm text-gray-600 mb-1">Sell Orders</div>
            <div className="text-2xl font-semibold text-red-600">{statistic.sell_trades}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Trade Statistics</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              Winning Trades
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Count</span>
                <span className="text-sm font-medium text-gray-900">{statistic.winning_trades}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Gross Profit</span>
                <span className="text-sm font-medium text-green-600">{formatNumber(statistic.gross_profit)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Average Win</span>
                <span className="text-sm font-medium text-green-600">{formatNumber(statistic.avg_win)}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-600">Largest Win</span>
                <span className="text-sm font-medium text-green-600">{formatNumber(statistic.largest_win)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              Losing Trades
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Count</span>
                <span className="text-sm font-medium text-gray-900">{statistic.losing_trades}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Gross Loss</span>
                <span className="text-sm font-medium text-red-600">{formatNumber(statistic.gross_loss)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Average Loss</span>
                <span className="text-sm font-medium text-red-600">{formatNumber(statistic.avg_loss)}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-600">Largest Loss</span>
                <span className="text-sm font-medium text-red-600">{formatNumber(statistic.largest_loss)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Cost Analysis</h2>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-3 border-b border-gray-100">
            <span className="text-sm text-gray-600">Total Cost (Fees + Position Cost)</span>
            <span className="text-sm font-medium text-gray-900">{formatNumber(statistic.total_cost)}</span>
          </div>
          <div className="flex justify-between items-center py-3 border-b border-gray-100">
            <span className="text-sm text-gray-600">Gross Profit</span>
            <span className="text-sm font-medium text-green-600">{formatNumber(statistic.gross_profit)}</span>
          </div>
          <div className="flex justify-between items-center py-3 border-b border-gray-100">
            <span className="text-sm text-gray-600">Gross Loss</span>
            <span className="text-sm font-medium text-red-600">{formatNumber(statistic.gross_loss)}</span>
          </div>
          <div className="flex justify-between items-center py-3 bg-gray-50 rounded-lg px-3">
            <span className="text-sm font-medium text-gray-700">Net Profit</span>
            <span className={`text-base font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {formatNumber(statistic.net_profit)}
            </span>
          </div>
        </div>
      </div>

      {statistic.trades.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">Trade History</h2>
            <div className="text-sm text-gray-500">
              {statistic.trades.length} orders · {statistic.total_trades} completed
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Time</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Type</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Price</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Amount</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Fee</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Profit</th>
                </tr>
              </thead>
              <tbody>
                {statistic.trades
                  .slice((currentPage - 1) * TRADES_PER_PAGE, currentPage * TRADES_PER_PAGE)
                  .map((trade, idx) => {
                    const isBuy = trade.trade_type === 'market_buy' || trade.trade_type === 'limit_buy'
                    const isLimit = trade.trade_type === 'limit_buy' || trade.trade_type === 'limit_sell'
                    const profitValue = Number(trade.profit)

                    return (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-600">
                          {formatTimestamp(trade.timestamp)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className={`text-xs font-medium px-2 py-1 rounded ${isBuy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {isBuy ? 'BUY' : 'SELL'}
                            </span>
                            {isLimit && (
                              <span className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded">
                                LIMIT
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-900 font-mono">
                          {formatPrice(trade.price)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-900 font-mono">
                          {formatAmount(trade.amount)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-500 font-mono">
                          {formatPrice(trade.fee)}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono font-medium ${profitValue > 0 ? 'text-green-600' : profitValue < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {profitValue !== 0 && trade.profit ? (profitValue > 0 ? '+' : '') + formatNumber(trade.profit, 2) : '-'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          {statistic.trades.length > TRADES_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Showing {((currentPage - 1) * TRADES_PER_PAGE) + 1} to {Math.min(currentPage * TRADES_PER_PAGE, statistic.trades.length)} of {statistic.trades.length} trades
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {Math.ceil(statistic.trades.length / TRADES_PER_PAGE)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(statistic.trades.length / TRADES_PER_PAGE), p + 1))}
                  disabled={currentPage >= Math.ceil(statistic.trades.length / TRADES_PER_PAGE)}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
